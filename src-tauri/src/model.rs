//! Authenticated model service transport and OS credential boundary.

use crate::types::ModelServiceConfig;
use serde::Serialize;
use specta::Type;
use std::sync::Arc;

mod context;
mod transport;
mod usage;
pub use context::{measure_context, ContextMeasurement, ModelContextConfig};
pub use transport::validate_config;
pub use usage::ModelUsage;
mod chat;
mod stream;
pub use chat::{
    validate_assistant_owner, AssistantModelMessage, AssistantModelTurn, AssistantRequestSnapshot,
};

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionReport {
    pub text: bool,
    pub tool_call: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ModelServiceError {
    InvalidConfig,
    MissingCredential,
    CredentialStore,
    Authentication,
    Network,
    Timeout,
    Protocol,
    ToolsUnsupported,
    RateLimited,
    ServiceUnavailable,
    Cancelled,
    BudgetExceeded,
    ContextTokensExceeded,
    ContextBytesExceeded,
    ContextMessagesExceeded,
    RequestBusy,
    InvalidIdentity,
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCredentialStatus {
    pub has_key: bool,
}

/// Only this OS boundary is substituted in credential tests. Errors and
/// diagnostics deliberately carry no OS message, key, endpoint or response.
pub trait CredentialStore: Send + Sync {
    fn contains(&self) -> Result<bool, ModelServiceError>;
    fn read(&self) -> Result<Option<String>, ModelServiceError>;
    fn save(&self, key: &str) -> Result<(), ModelServiceError>;
    fn remove(&self) -> Result<(), ModelServiceError>;
}

#[derive(Clone)]
pub struct ModelService<S> {
    store: S,
    credential_gate: Arc<tokio::sync::Mutex<()>>,
    assistant: Arc<chat::AssistantRequests>,
}

impl<S: CredentialStore + Clone + 'static> ModelService<S> {
    pub fn new(store: S) -> Self {
        Self {
            store,
            credential_gate: Arc::new(tokio::sync::Mutex::new(())),
            assistant: Arc::new(chat::AssistantRequests::default()),
        }
    }

    pub async fn credential_status(&self) -> Result<ModelCredentialStatus, ModelServiceError> {
        Ok(ModelCredentialStatus {
            has_key: self.with_credentials(|store| store.contains()).await?,
        })
    }

    pub async fn save_credential(&self, key: &str) -> Result<(), ModelServiceError> {
        validate_key(key)?;
        let key = key.to_string();
        let assistant = self.assistant.clone();
        self.with_credentials(move |store| {
            store.save(&key)?;
            assistant.invalidate();
            Ok(())
        })
        .await
    }

    pub async fn remove_credential(&self) -> Result<(), ModelServiceError> {
        let assistant = self.assistant.clone();
        self.with_credentials(move |store| {
            store.remove()?;
            assistant.invalidate();
            Ok(())
        })
        .await
    }

    async fn with_credentials<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&S) -> Result<T, ModelServiceError> + Send + 'static,
    ) -> Result<T, ModelServiceError> {
        // One App-managed service serializes all native reads and mutations.
        // The blocking worker owns the guard so even cancellation cannot let
        // a later remove race an older Keychain prompt that is still active.
        let guard = self.credential_gate.clone().lock_owned().await;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            operation(&store)
        })
        .await
        .map_err(|_| ModelServiceError::CredentialStore)?
    }

    pub async fn test_connection(
        &self,
        config: &ModelServiceConfig,
        key: Option<&str>,
    ) -> Result<ModelConnectionReport, ModelServiceError> {
        validate_config(config)?;
        let source = if key.is_some() { "input" } else { "keychain" };
        log::info!("[model-connection] started credential_source={source}");
        let key = match key {
            Some(key) => key.to_string(),
            None => self
                .with_credentials(|store| store.read())
                .await
                .inspect_err(|error| {
                    log::warn!("[model-connection] failed phase=credential_read error={error:?}");
                })?
                .ok_or(ModelServiceError::MissingCredential)?,
        };
        validate_key(&key)?;
        transport::test_connection(config, &key).await
    }
}

fn validate_key(key: &str) -> Result<(), ModelServiceError> {
    if key.trim().is_empty() {
        return Err(ModelServiceError::MissingCredential);
    }
    if key.len() > 4096 || !key.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(ModelServiceError::InvalidConfig);
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub struct KeychainCredentials;

#[cfg(target_os = "macos")]
impl CredentialStore for KeychainCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
        match ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(KEYCHAIN_SERVICE)
            .account(KEYCHAIN_ACCOUNT)
            .limit(Limit::Max(1))
            .load_attributes(true)
            .load_data(false)
            .search()
        {
            Ok(items) => Ok(!items.is_empty()),
            Err(error) if error.code() == KEYCHAIN_NOT_FOUND => Ok(false),
            Err(error) => Err(keychain_failure("status", error.code())),
        }
    }

    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
        match generic_password(options) {
            Ok(value) => String::from_utf8(value)
                .map(Some)
                .map_err(|_| ModelServiceError::CredentialStore),
            Err(error) if error.code() == KEYCHAIN_NOT_FOUND => Ok(None),
            Err(error) => Err(keychain_failure("read", error.code())),
        }
    }

    fn save(&self, key: &str) -> Result<(), ModelServiceError> {
        security_framework::passwords::set_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
            key.as_bytes(),
        )
        .map_err(|error| keychain_failure("save", error.code()))
    }

    fn remove(&self) -> Result<(), ModelServiceError> {
        match security_framework::passwords::delete_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
        ) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == KEYCHAIN_NOT_FOUND => Ok(()),
            Err(error) => Err(keychain_failure("remove", error.code())),
        }
    }
}

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "app.pnds.model-service";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "current";
#[cfg(target_os = "macos")]
const KEYCHAIN_NOT_FOUND: i32 = -25300; // Security.framework errSecItemNotFound.

#[cfg(target_os = "macos")]
fn keychain_failure(operation: &'static str, status: i32) -> ModelServiceError {
    log::warn!("[model-keychain] operation={operation} os_status={status}");
    ModelServiceError::CredentialStore
}

#[cfg(not(target_os = "macos"))]
impl CredentialStore for KeychainCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        Err(ModelServiceError::CredentialStore)
    }
    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        Err(ModelServiceError::CredentialStore)
    }
    fn save(&self, _key: &str) -> Result<(), ModelServiceError> {
        Err(ModelServiceError::CredentialStore)
    }
    fn remove(&self) -> Result<(), ModelServiceError> {
        Err(ModelServiceError::CredentialStore)
    }
}

#[cfg(test)]
mod tests;
