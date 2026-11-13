//! GitHub App device authorization and the native credential boundary.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

mod api;
mod keychain;

pub(crate) use api::repository_name;
use api::{Api, DeviceGrant, OAuthReply};

pub(crate) const OFFICIAL_TEMPLATE_REPOSITORY: &str = "xO-xN/PNDS-Template";
const OFFICIAL_TEMPLATE_ID: u64 = 1326767366;

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GithubError {
    NotConfigured,
    Disconnected,
    CredentialStore,
    Authentication,
    Network,
    Timeout,
    RateLimited,
    Protocol,
    ServiceUnavailable,
    DeviceExpired,
    AccessDenied,
    RepositoryUnavailable,
    InvalidRepository,
    TooManyResults,
    Unsupported,
    Storage,
    WorkspaceChanged,
    Conflict,
    ConfirmationRequired,
    ConfirmationExpired,
    UpdateBlocked,
    TargetExists,
    RepositoryNameUnavailable,
    CreationForbidden,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubAccount {
    pub id: String,
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepository {
    pub id: String,
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    pub can_push: bool,
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthStatus {
    pub configured: bool,
    pub account: Option<GithubAccount>,
    pub installation_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubDeviceCode {
    pub id: String,
    pub user_code: String,
    pub verification_url: String,
    pub interval_secs: u32,
    pub expires_in_secs: u32,
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum GithubAuthPoll {
    Pending {
        #[serde(rename = "intervalSecs")]
        interval_secs: u32,
    },
    Connected {
        account: GithubAccount,
    },
}

pub struct GithubAccess {
    pub account: GithubAccount,
    token: String,
}

impl GithubAccess {
    pub fn token(&self) -> &str {
        &self.token
    }
}

#[derive(Clone)]
struct Config {
    client_id: String,
    installation_url: String,
}

impl Config {
    fn load() -> Option<Self> {
        let client_id = std::env::var("PNDS_GITHUB_CLIENT_ID")
            .ok()
            .or_else(|| option_env!("PNDS_GITHUB_CLIENT_ID").map(str::to_owned))?;
        let slug = std::env::var("PNDS_GITHUB_APP_SLUG")
            .ok()
            .or_else(|| option_env!("PNDS_GITHUB_APP_SLUG").map(str::to_owned))?;
        Self::parse(client_id, &slug)
    }

    fn parse(client_id: String, slug: &str) -> Option<Self> {
        if client_id.is_empty()
            || client_id.len() > 128
            || !client_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
            || slug.is_empty()
            || slug.len() > 100
            || !slug
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return None;
        }
        Some(Self {
            client_id,
            installation_url: format!("https://github.com/apps/{slug}/installations/new"),
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    expires_at: u64,
    refresh_token: String,
    refresh_expires_at: u64,
}

impl Tokens {
    fn validated(
        access_token: String,
        expires_in: u64,
        refresh_token: String,
        refresh_expires_in: u64,
        now: u64,
    ) -> Result<Self, GithubError> {
        if !valid_token(&access_token, "ghu_")
            || !valid_token(&refresh_token, "ghr_")
            || !(1..=86_400).contains(&expires_in)
            || !(expires_in..=31_622_400).contains(&refresh_expires_in)
        {
            return Err(GithubError::Protocol);
        }
        Ok(Self {
            access_token,
            expires_at: now.saturating_add(expires_in),
            refresh_token,
            refresh_expires_at: now.saturating_add(refresh_expires_in),
        })
    }
}

fn valid_token(token: &str, prefix: &str) -> bool {
    token.strip_prefix(prefix).is_some_and(|body| {
        !body.is_empty()
            && body.len() <= 512
            && body
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

#[derive(Clone, Serialize, Deserialize)]
struct Credential {
    account: GithubAccount,
    tokens: Tokens,
}

struct PendingDevice {
    id: String,
    device_code: String,
    expires_at: Instant,
    interval_secs: u32,
    next_poll: Instant,
    tokens: Option<Tokens>,
}

impl PendingDevice {
    fn new(grant: DeviceGrant, now: Instant) -> Result<(Self, GithubDeviceCode), GithubError> {
        let mut random = [0; 16];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| GithubError::Protocol)?;
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let result = GithubDeviceCode {
            id: id.clone(),
            user_code: grant.user_code,
            verification_url: api::DEVICE_VERIFICATION.to_owned(),
            interval_secs: grant.interval,
            expires_in_secs: grant.expires_in,
        };
        let pending = Self {
            id,
            device_code: grant.device_code,
            expires_at: now + Duration::from_secs(grant.expires_in.into()),
            interval_secs: grant.interval,
            next_poll: now + Duration::from_secs(grant.interval.into()),
            tokens: None,
        };
        Ok((pending, result))
    }

    fn slow_down(&mut self, interval: Option<u32>, now: Instant) {
        self.interval_secs = self
            .interval_secs
            .saturating_add(5)
            .max(interval.unwrap_or(0))
            .min(900);
        self.next_poll = now + Duration::from_secs(self.interval_secs.into());
    }

    fn remaining_interval(&self, now: Instant) -> u32 {
        self.next_poll
            .saturating_duration_since(now)
            .as_millis()
            .div_ceil(1000) as u32
    }
}

#[derive(Default)]
struct AuthState {
    pending: Option<PendingDevice>,
    // A successful refresh consumes the previous refresh token immediately.
    // Retain the rotation in memory until the replacement Keychain write succeeds.
    rotated: Option<Credential>,
}

#[derive(Clone)]
pub struct GithubAuth {
    config: Option<Config>,
    api: Result<Api, GithubError>,
    state: Arc<Mutex<AuthState>>,
}

impl GithubAuth {
    pub fn new() -> Self {
        Self {
            config: Config::load(),
            api: Api::new(),
            state: Arc::default(),
        }
    }

    #[cfg(all(feature = "native-client-fixture", target_os = "macos"))]
    pub(crate) fn for_fixture() -> Self {
        Self {
            config: None,
            api: Api::new(),
            state: Arc::default(),
        }
    }

    fn api(&self) -> Result<&Api, GithubError> {
        self.api.as_ref().map_err(|error| *error)
    }

    async fn status(&self) -> Result<GithubAuthStatus, GithubError> {
        let Some(config) = &self.config else {
            return Ok(GithubAuthStatus {
                configured: false,
                account: None,
                installation_url: None,
            });
        };
        let state = self.state.lock().await;
        let account = match &state.rotated {
            Some(credential) => Some(credential.account.clone()),
            None => keychain::read(config)
                .await?
                .map(|credential| credential.account),
        };
        Ok(GithubAuthStatus {
            configured: true,
            account,
            installation_url: Some(config.installation_url.clone()),
        })
    }

    async fn begin(&self) -> Result<GithubDeviceCode, GithubError> {
        let config = self.config.as_ref().ok_or(GithubError::NotConfigured)?;
        let mut state = self.state.lock().await;
        state.pending = None;
        let grant = self.api()?.device_grant(&config.client_id).await?;
        let (pending, public_code) = PendingDevice::new(grant, Instant::now())?;
        state.pending = Some(pending);
        Ok(public_code)
    }

    async fn poll(&self, id: &str) -> Result<GithubAuthPoll, GithubError> {
        let config = self.config.as_ref().ok_or(GithubError::NotConfigured)?;
        let mut state = self.state.lock().await;
        let now = Instant::now();
        let pending = state
            .pending
            .as_mut()
            .filter(|pending| pending.id == id)
            .ok_or(GithubError::DeviceExpired)?;
        if now >= pending.expires_at {
            state.pending = None;
            return Err(GithubError::DeviceExpired);
        }
        if pending.tokens.is_none() {
            let interval_secs = pending.remaining_interval(now);
            if interval_secs > 0 {
                return Ok(GithubAuthPoll::Pending { interval_secs });
            }
            pending.next_poll = now + Duration::from_secs(pending.interval_secs.into());
            match self
                .api()?
                .device_poll(&config.client_id, &pending.device_code)
                .await?
            {
                OAuthReply::Pending => {
                    return Ok(GithubAuthPoll::Pending {
                        interval_secs: pending.interval_secs,
                    })
                }
                OAuthReply::SlowDown(interval) => {
                    pending.slow_down(interval, Instant::now());
                    return Ok(GithubAuthPoll::Pending {
                        interval_secs: pending.interval_secs,
                    });
                }
                OAuthReply::Token(tokens) => pending.tokens = Some(tokens),
                OAuthReply::Rejected(error) => {
                    state.pending = None;
                    return Err(error);
                }
            }
        }
        let tokens = pending.tokens.as_ref().ok_or(GithubError::Protocol)?;
        let account = self.api()?.account(&tokens.access_token).await?;
        keychain::save(
            config,
            Credential {
                account: account.clone(),
                tokens: tokens.clone(),
            },
        )
        .await?;
        state.pending = None;
        state.rotated = None;
        Ok(GithubAuthPoll::Connected { account })
    }

    async fn disconnect(&self) -> Result<(), GithubError> {
        let config = self.config.as_ref().ok_or(GithubError::NotConfigured)?;
        let mut state = self.state.lock().await;
        keychain::remove(config).await?;
        state.pending = None;
        state.rotated = None;
        Ok(())
    }

    pub async fn access(&self) -> Result<GithubAccess, GithubError> {
        let auth = self.clone();
        // The token rotation and Keychain write must finish even if the WebView
        // abandons the command while a native credential prompt is open.
        tokio::spawn(async move { auth.resolve_access().await })
            .await
            .map_err(|_| GithubError::CredentialStore)?
    }

    async fn resolve_access(&self) -> Result<GithubAccess, GithubError> {
        let config = self.config.as_ref().ok_or(GithubError::NotConfigured)?;
        let mut state = self.state.lock().await;
        let mut credential = match &state.rotated {
            Some(rotated) => {
                keychain::save(config, rotated.clone()).await?;
                state.rotated.take().ok_or(GithubError::CredentialStore)?
            }
            None => keychain::read(config)
                .await?
                .ok_or(GithubError::Disconnected)?,
        };
        let now = unix_now()?;
        if credential.tokens.expires_at <= now.saturating_add(60) {
            if credential.tokens.refresh_expires_at <= now {
                return Err(GithubError::Authentication);
            }
            credential.tokens = self
                .api()?
                .refresh(&config.client_id, &credential.tokens.refresh_token)
                .await?;
            state.rotated = Some(credential.clone());
            keychain::save(config, credential.clone()).await?;
            state.rotated = None;
        }
        Ok(GithubAccess {
            account: credential.account,
            token: credential.tokens.access_token,
        })
    }

    pub async fn authorized_repository(
        &self,
        access: &GithubAccess,
        full_name: &str,
    ) -> Result<GithubRepository, GithubError> {
        api::repository_name(full_name)?;
        self.api()?
            .authorized_repositories(access.token())
            .await?
            .into_iter()
            .find(|repo| repo.full_name.eq_ignore_ascii_case(full_name))
            .ok_or(GithubError::RepositoryUnavailable)
    }

    pub async fn public_repository(
        &self,
        full_name: &str,
    ) -> Result<GithubRepository, GithubError> {
        self.api()?.public_repository(full_name).await
    }

    pub(crate) async fn creation_owners(
        &self,
        access: &GithubAccess,
    ) -> Result<Vec<String>, GithubError> {
        self.api()?.creation_owners(access.token()).await
    }

    pub(crate) async fn generate_template(
        &self,
        access: &GithubAccess,
        owner: &str,
        name: &str,
        private: bool,
    ) -> Result<GithubRepository, GithubError> {
        self.api()?
            .generate_template(access.token(), owner, name, private)
            .await
    }

    pub(crate) async fn official_template_source(
        &self,
        access: &GithubAccess,
        expected: &GithubRepository,
    ) -> Result<bool, GithubError> {
        self.api()?
            .official_template_source(access.token(), expected)
            .await
    }

    async fn branches(&self, full_name: &str) -> Result<Vec<String>, GithubError> {
        let api = self.api()?;
        let access = match self.access().await {
            Ok(access) => match self.authorized_repository(&access, full_name).await {
                Ok(repo) => return api.branches(&repo.full_name, Some(access.token())).await,
                Err(GithubError::RepositoryUnavailable) => None,
                Err(error) => Some(error),
            },
            Err(GithubError::Disconnected | GithubError::NotConfigured) => None,
            Err(error) => Some(error),
        };
        match self.public_repository(full_name).await {
            Ok(repo) => api.branches(&repo.full_name, None).await,
            Err(GithubError::RepositoryUnavailable) => {
                Err(access.unwrap_or(GithubError::RepositoryUnavailable))
            }
            Err(error) => Err(error),
        }
    }
}

fn unix_now() -> Result<u64, GithubError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs())
        .map_err(|_| GithubError::Protocol)
}

#[tauri::command]
#[specta::specta]
pub async fn github_auth_status(
    auth: State<'_, GithubAuth>,
) -> Result<GithubAuthStatus, GithubError> {
    auth.status().await
}

#[tauri::command]
#[specta::specta]
pub async fn github_begin_auth(
    auth: State<'_, GithubAuth>,
) -> Result<GithubDeviceCode, GithubError> {
    auth.begin().await
}

#[tauri::command]
#[specta::specta]
pub async fn github_poll_auth(
    auth: State<'_, GithubAuth>,
    id: String,
) -> Result<GithubAuthPoll, GithubError> {
    let auth = auth.inner().clone();
    tokio::spawn(async move { auth.poll(&id).await })
        .await
        .map_err(|_| GithubError::CredentialStore)?
}

#[tauri::command]
#[specta::specta]
pub async fn github_disconnect(
    app: AppHandle,
    auth: State<'_, GithubAuth>,
) -> Result<(), GithubError> {
    let auth = auth.inner().clone();
    tokio::spawn(async move {
        let sync = app.try_state::<crate::commands::github_sync::GithubSync>();
        let _operation = match &sync {
            Some(sync) => Some(sync.operation.lock().await),
            None => None,
        };
        auth.disconnect().await
    })
    .await
    .map_err(|_| GithubError::CredentialStore)?
}

#[tauri::command]
#[specta::specta]
pub async fn github_list_repositories(
    auth: State<'_, GithubAuth>,
) -> Result<Vec<GithubRepository>, GithubError> {
    let access = auth.access().await?;
    auth.api()?.authorized_repositories(access.token()).await
}

#[tauri::command]
#[specta::specta]
pub async fn github_list_branches(
    auth: State<'_, GithubAuth>,
    full_name: String,
) -> Result<Vec<String>, GithubError> {
    auth.branches(&full_name).await
}

#[cfg(test)]
mod tests;
