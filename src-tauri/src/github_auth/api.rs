use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::{Client, RequestBuilder, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use super::{
    unix_now, GithubAccount, GithubError, GithubRepository, Tokens, OFFICIAL_TEMPLATE_ID,
    OFFICIAL_TEMPLATE_REPOSITORY,
};

const API: &str = "https://api.github.com";
const API_VERSION: &str = "2026-03-10";
const DEVICE_ENDPOINT: &str = "https://github.com/login/device/code";
const TOKEN_ENDPOINT: &str = "https://github.com/login/oauth/access_token";
pub(super) const DEVICE_VERIFICATION: &str = "https://github.com/login/device";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: u32 = 50;
const MAX_BODY: usize = 4 * 1024 * 1024;
const READ_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub(super) struct Api {
    client: Client,
    #[cfg(test)]
    test_origin: Option<String>,
}

impl Api {
    pub(super) fn new() -> Result<Self, GithubError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .user_agent("PNDS-App")
            .build()
            .map(|client| Self {
                client,
                #[cfg(test)]
                test_origin: None,
            })
            .map_err(transport_error)
    }

    pub(super) async fn device_grant(&self, client_id: &str) -> Result<DeviceGrant, GithubError> {
        let reply: DeviceGrantReply = send(
            "device code",
            self.oauth(
                DEVICE_ENDPOINT,
                &[("client_id", client_id), ("scope", "offline_access")],
            ),
        )
        .await?;
        reply.validate()
    }

    pub(super) async fn device_poll(
        &self,
        client_id: &str,
        device_code: &str,
    ) -> Result<OAuthReply, GithubError> {
        let reply: TokenReply = send(
            "device token poll",
            self.oauth(
                TOKEN_ENDPOINT,
                &[
                    ("client_id", client_id),
                    ("device_code", device_code),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ],
            ),
        )
        .await?;
        reply.interpret(unix_now()?)
    }

    pub(super) async fn refresh(
        &self,
        client_id: &str,
        refresh: &str,
    ) -> Result<Tokens, GithubError> {
        let reply: TokenReply = send(
            "token refresh",
            self.oauth(
                TOKEN_ENDPOINT,
                &[
                    ("client_id", client_id),
                    ("refresh_token", refresh),
                    ("grant_type", "refresh_token"),
                ],
            ),
        )
        .await?;
        match reply.interpret(unix_now()?)? {
            OAuthReply::Token(tokens) => Ok(tokens),
            OAuthReply::Rejected(error) => Err(error),
            _ => Err(GithubError::Protocol),
        }
    }

    fn oauth(&self, endpoint: &str, fields: &[(&str, &str)]) -> RequestBuilder {
        self.client
            .post(endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .form(fields)
    }

    fn get(&self, path: &str, token: Option<&str>) -> RequestBuilder {
        let origin = API;
        #[cfg(test)]
        let origin = self.test_origin.as_deref().unwrap_or(origin);
        let request = self
            .client
            .get(format!("{origin}{path}"))
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION);
        match token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    async fn page<T: DeserializeOwned>(
        &self,
        operation: &'static str,
        path: &str,
        token: Option<&str>,
        page: u32,
    ) -> Result<T, GithubError> {
        self.read(
            operation,
            &format!("{path}?per_page={PAGE_SIZE}&page={page}"),
            token,
        )
        .await
    }

    async fn read<T: DeserializeOwned>(
        &self,
        operation: &'static str,
        path: &str,
        token: Option<&str>,
    ) -> Result<T, GithubError> {
        send_read(operation, READ_ATTEMPT_TIMEOUT, || self.get(path, token)).await
    }

    pub(super) async fn account(&self, token: &str) -> Result<GithubAccount, GithubError> {
        let wire: AccountReply = self.read("account", "/user", Some(token)).await?;
        wire.into_account()
    }

    pub(super) async fn authorized_repositories(
        &self,
        token: &str,
    ) -> Result<Vec<GithubRepository>, GithubError> {
        let mut repos = BTreeMap::new();
        let mut repo_pages = 0;
        for page in 1..=MAX_PAGES {
            let reply: Installations = self
                .page("installations", "/user/installations", Some(token), page)
                .await?;
            let complete = reply.installations.len() < PAGE_SIZE;
            for installation in reply.installations {
                let contents = installation.permissions.contents.as_deref();
                if installation.suspended_at.is_some()
                    || !matches!(contents, Some("read" | "write"))
                {
                    continue;
                }
                let path = format!("/user/installations/{}/repositories", installation.id);
                for page in 1..=MAX_PAGES {
                    repo_pages += 1;
                    if repo_pages > MAX_PAGES {
                        return Err(GithubError::TooManyResults);
                    }
                    let reply: RepositoryPage = self
                        .page("installation repositories", &path, Some(token), page)
                        .await?;
                    let complete = reply.repositories.len() < PAGE_SIZE;
                    for wire in reply.repositories {
                        let repo = wire.into_repository(contents == Some("write"))?;
                        let key = repo.full_name.to_ascii_lowercase();
                        // Multiple accessible installations can describe the same
                        // repository. Preserve the strongest verified capability.
                        if let Some(entry) = repos.get_mut(&key) {
                            let entry: &mut GithubRepository = entry;
                            if entry.id != repo.id {
                                return Err(GithubError::RepositoryUnavailable);
                            }
                            entry.private &= repo.private;
                            entry.can_push |= repo.can_push;
                        } else {
                            repos.insert(key, repo);
                        }
                    }
                    if complete {
                        break;
                    }
                    if repo_pages == MAX_PAGES {
                        return Err(GithubError::TooManyResults);
                    }
                }
            }
            if complete {
                return Ok(repos.into_values().collect());
            }
        }
        Err(GithubError::TooManyResults)
    }

    pub(super) async fn public_repository(
        &self,
        full_name: &str,
    ) -> Result<GithubRepository, GithubError> {
        repository_name(full_name)?;
        let reply: RepositoryReply = self
            .read("public repository", &format!("/repos/{full_name}"), None)
            .await?;
        let repo = reply.into_repository(false)?;
        if repo.private || !repo.full_name.eq_ignore_ascii_case(full_name) {
            return Err(GithubError::RepositoryUnavailable);
        }
        Ok(repo)
    }

    pub(super) async fn official_template_source(
        &self,
        token: &str,
        expected: &GithubRepository,
    ) -> Result<bool, GithubError> {
        let full_name = &expected.full_name;
        repository_name(full_name)?;
        let reply: TemplateTargetReply = self
            .read(
                "template target",
                &format!("/repos/{full_name}"),
                Some(token),
            )
            .await?;
        reply.matches(expected)
    }

    pub(super) async fn branches(
        &self,
        full_name: &str,
        token: Option<&str>,
    ) -> Result<Vec<String>, GithubError> {
        repository_name(full_name)?;
        let path = format!("/repos/{full_name}/branches");
        let mut branches = Vec::new();
        for page in 1..=MAX_PAGES {
            let reply: Vec<BranchReply> = self.page("branches", &path, token, page).await?;
            let complete = reply.len() < PAGE_SIZE;
            for branch in reply {
                if !valid_branch(&branch.name) {
                    return Err(GithubError::Protocol);
                }
                branches.push(branch.name);
            }
            if complete {
                return Ok(branches);
            }
        }
        Err(GithubError::TooManyResults)
    }
}

fn transport_error(error: reqwest::Error) -> GithubError {
    if error.is_timeout() {
        GithubError::Timeout
    } else {
        GithubError::Network
    }
}

async fn send_read<T: DeserializeOwned>(
    operation: &'static str,
    attempt_timeout: Duration,
    request: impl Fn() -> RequestBuilder,
) -> Result<T, GithubError> {
    match send(operation, request().timeout(attempt_timeout)).await {
        Err(GithubError::Timeout) => {
            log::debug!("Retrying GitHub API {operation} after timeout");
            send(operation, request().timeout(attempt_timeout)).await
        }
        result => result,
    }
}

fn request_error(operation: &str, phase: &str, error: reqwest::Error) -> GithubError {
    let error = transport_error(error);
    log::warn!("GitHub API {operation} failed while {phase}: {error:?}");
    error
}

async fn send<T: DeserializeOwned>(
    operation: &'static str,
    request: RequestBuilder,
) -> Result<T, GithubError> {
    let mut response = request
        .send()
        .await
        .map_err(|error| request_error(operation, "waiting for response headers", error))?;
    response_status(&response)?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err(GithubError::Protocol);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| request_error(operation, "reading response body", error))?
    {
        if chunk.len() > MAX_BODY.saturating_sub(body.len()) {
            return Err(GithubError::Protocol);
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| GithubError::Protocol)
}

fn response_status(response: &Response) -> Result<(), GithubError> {
    let status = response.status();
    let rate_limited = response
        .headers()
        .contains_key(reqwest::header::RETRY_AFTER)
        || response
            .headers()
            .get("x-ratelimit-remaining")
            .is_some_and(|value| value == "0");
    match status {
        success if success.is_success() => Ok(()),
        StatusCode::UNAUTHORIZED => Err(GithubError::Authentication),
        StatusCode::FORBIDDEN if rate_limited => Err(GithubError::RateLimited),
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::CONFLICT => {
            Err(GithubError::RepositoryUnavailable)
        }
        StatusCode::TOO_MANY_REQUESTS => Err(GithubError::RateLimited),
        error if error.is_server_error() => Err(GithubError::ServiceUnavailable),
        _ => Err(GithubError::Protocol),
    }
}

pub(super) struct DeviceGrant {
    pub(super) device_code: String,
    pub(super) user_code: String,
    pub(super) expires_in: u32,
    pub(super) interval: u32,
}

#[derive(Deserialize)]
struct DeviceGrantReply {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u32>,
    interval: Option<u32>,
    error: Option<String>,
}

impl DeviceGrantReply {
    fn validate(self) -> Result<DeviceGrant, GithubError> {
        if let Some(error) = &self.error {
            return Err(oauth_error(error));
        }
        let device_code = self.device_code.filter(|code| {
            code.len() == 40 && code.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
        let user_code = self.user_code.filter(|code| {
            code.len() == 9
                && code.bytes().enumerate().all(|(index, byte)| {
                    if index == 4 {
                        byte == b'-'
                    } else {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit()
                    }
                })
        });
        match (
            device_code,
            user_code,
            self.verification_uri.as_deref(),
            self.expires_in,
            self.interval,
        ) {
            (
                Some(device_code),
                Some(user_code),
                Some(DEVICE_VERIFICATION),
                Some(expires_in @ 1..=900),
                Some(interval @ 1..=60),
            ) => Ok(DeviceGrant {
                device_code,
                user_code,
                expires_in,
                interval,
            }),
            _ => Err(GithubError::Protocol),
        }
    }
}

pub(super) enum OAuthReply {
    Pending,
    SlowDown(Option<u32>),
    Token(Tokens),
    Rejected(GithubError),
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    refresh_token_expires_in: Option<u64>,
    interval: Option<u32>,
    error: Option<String>,
}

impl TokenReply {
    fn interpret(self, now: u64) -> Result<OAuthReply, GithubError> {
        if let Some(error) = self.error {
            return Ok(match error.as_str() {
                "authorization_pending" => OAuthReply::Pending,
                "slow_down" => OAuthReply::SlowDown(self.interval),
                _ => OAuthReply::Rejected(oauth_error(&error)),
            });
        }
        let Self {
            access_token: Some(access_token),
            refresh_token: Some(refresh_token),
            token_type: Some(token_type),
            expires_in: Some(expires_in),
            refresh_token_expires_in: Some(refresh_token_expires_in),
            ..
        } = self
        else {
            return Err(GithubError::Protocol);
        };
        if !token_type.eq_ignore_ascii_case("bearer") {
            return Err(GithubError::Protocol);
        }
        Tokens::validated(
            access_token,
            expires_in,
            refresh_token,
            refresh_token_expires_in,
            now,
        )
        .map(OAuthReply::Token)
    }
}

fn oauth_error(error: &str) -> GithubError {
    match error {
        "expired_token" | "token_expired" | "incorrect_device_code" => GithubError::DeviceExpired,
        "access_denied" => GithubError::AccessDenied,
        "incorrect_client_credentials" | "device_flow_disabled" => GithubError::NotConfigured,
        "bad_refresh_token" | "invalid_grant" => GithubError::Authentication,
        "temporarily_unavailable" | "server_error" => GithubError::ServiceUnavailable,
        _ => GithubError::Protocol,
    }
}

#[derive(Deserialize)]
struct AccountReply {
    id: u64,
    login: String,
    avatar_url: Option<String>,
}

impl AccountReply {
    fn into_account(self) -> Result<GithubAccount, GithubError> {
        if self.id == 0 || !valid_owner(&self.login) {
            return Err(GithubError::Protocol);
        }
        Ok(GithubAccount {
            id: self.id.to_string(),
            login: self.login,
            avatar_url: self.avatar_url.filter(|value| valid_avatar(value)),
        })
    }
}

pub(super) fn valid_avatar(value: &str) -> bool {
    value.len() <= 1024
        && value.starts_with("https://avatars.githubusercontent.com/")
        && Url::parse(value).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str() == Some("avatars.githubusercontent.com")
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
        })
}

#[derive(Deserialize)]
struct Installations {
    installations: Vec<Installation>,
}

#[derive(Deserialize)]
struct Installation {
    id: u64,
    permissions: InstallationPermissions,
    suspended_at: Option<String>,
}

#[derive(Deserialize)]
struct InstallationPermissions {
    contents: Option<String>,
}

#[derive(Deserialize)]
struct RepositoryPage {
    repositories: Vec<RepositoryReply>,
}

#[derive(Deserialize)]
struct RepositoryReply {
    id: u64,
    full_name: String,
    private: bool,
    default_branch: String,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    disabled: bool,
    permissions: Option<RepositoryPermissions>,
}

impl RepositoryReply {
    fn into_repository(self, installation_write: bool) -> Result<GithubRepository, GithubError> {
        if self.id == 0
            || repository_name(&self.full_name).is_err()
            || !valid_branch(&self.default_branch)
        {
            return Err(GithubError::Protocol);
        }
        Ok(GithubRepository {
            id: self.id.to_string(),
            full_name: self.full_name,
            private: self.private,
            default_branch: self.default_branch,
            can_push: installation_write
                && !self.archived
                && !self.disabled
                && self.permissions.is_some_and(|permissions| permissions.push),
        })
    }
}

#[derive(Deserialize)]
struct TemplateTargetReply {
    #[serde(flatten)]
    repository: RepositoryReply,
    template_repository: Option<TemplateRepositoryReply>,
}

#[derive(Deserialize)]
struct TemplateRepositoryReply {
    id: u64,
    full_name: String,
}

impl TemplateTargetReply {
    fn matches(self, expected: &GithubRepository) -> Result<bool, GithubError> {
        let access_denied = !expected.can_push
            || self.repository.archived
            || self.repository.disabled
            || self
                .repository
                .permissions
                .as_ref()
                .is_some_and(|permissions| !permissions.push);
        let current = self.repository.into_repository(expected.can_push)?;
        if current.id != expected.id
            || !current.full_name.eq_ignore_ascii_case(&expected.full_name)
            || current.default_branch != expected.default_branch
            || current.private != expected.private
        {
            return Err(GithubError::Conflict);
        }
        if access_denied {
            return Err(GithubError::AccessDenied);
        }
        Ok(self.template_repository.is_some_and(|source| {
            source.id == OFFICIAL_TEMPLATE_ID
                && source
                    .full_name
                    .eq_ignore_ascii_case(OFFICIAL_TEMPLATE_REPOSITORY)
        }))
    }
}

#[derive(Deserialize)]
struct RepositoryPermissions {
    #[serde(default)]
    push: bool,
}

#[derive(Deserialize)]
struct BranchReply {
    name: String,
}

pub(super) fn repository_name(full_name: &str) -> Result<(), GithubError> {
    let (owner, repo) = full_name
        .split_once('/')
        .ok_or(GithubError::InvalidRepository)?;
    if !valid_owner(owner)
        || repo.is_empty()
        || repo.len() > 100
        || matches!(repo, "." | "..")
        || !repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(GithubError::InvalidRepository);
    }
    Ok(())
}

pub(super) fn valid_owner(owner: &str) -> bool {
    (1..=39).contains(&owner.len())
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !owner.starts_with('-')
        && !owner.ends_with('-')
}

fn valid_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 1024
        && git2::Branch::name_is_valid(branch).unwrap_or(false)
}

#[cfg(test)]
mod tests;
