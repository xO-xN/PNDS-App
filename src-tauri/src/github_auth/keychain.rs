use super::{api, valid_token, Config, Credential, GithubError};

#[cfg(target_os = "macos")]
const SERVICE: &str = "app.pnds.github-app";
#[cfg(target_os = "macos")]
const NOT_FOUND: i32 = -25300;

pub(super) async fn read(config: &Config) -> Result<Option<Credential>, GithubError> {
    let client_id = config.client_id.clone();
    worker(move || read_item(&client_id)?.map(|item| decode(&item)).transpose()).await
}

pub(super) async fn save(config: &Config, credential: Credential) -> Result<(), GithubError> {
    let client_id = config.client_id.clone();
    worker(move || {
        let item = serde_json::to_vec(&credential).map_err(|_| GithubError::CredentialStore)?;
        save_item(&client_id, &item)
    })
    .await
}

pub(super) async fn remove(config: &Config) -> Result<(), GithubError> {
    let client_id = config.client_id.clone();
    worker(move || remove_item(&client_id)).await
}

async fn worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, GithubError> + Send + 'static,
) -> Result<T, GithubError> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| GithubError::CredentialStore)?
}

fn decode(item: &[u8]) -> Result<Credential, GithubError> {
    if item.len() > 8192 {
        return Err(GithubError::CredentialStore);
    }
    let mut credential: Credential =
        serde_json::from_slice(item).map_err(|_| GithubError::CredentialStore)?;
    if !valid_token(&credential.tokens.access_token, "ghu_")
        || !valid_token(&credential.tokens.refresh_token, "ghr_")
        || credential.tokens.expires_at == 0
        || credential.tokens.refresh_expires_at < credential.tokens.expires_at
        || !credential.account.id.parse::<u64>().is_ok_and(|id| id != 0)
        || !api::valid_owner(&credential.account.login)
    {
        return Err(GithubError::CredentialStore);
    }
    credential.account.avatar_url = credential
        .account
        .avatar_url
        .filter(|url| api::valid_avatar(url));
    Ok(credential)
}

#[cfg(target_os = "macos")]
fn read_item(client_id: &str) -> Result<Option<Vec<u8>>, GithubError> {
    match security_framework::passwords::get_generic_password(SERVICE, client_id) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == NOT_FOUND => Ok(None),
        Err(_) => Err(GithubError::CredentialStore),
    }
}

#[cfg(target_os = "macos")]
fn save_item(client_id: &str, item: &[u8]) -> Result<(), GithubError> {
    security_framework::passwords::set_generic_password(SERVICE, client_id, item)
        .map_err(|_| GithubError::CredentialStore)
}

#[cfg(target_os = "macos")]
fn remove_item(client_id: &str) -> Result<(), GithubError> {
    match security_framework::passwords::delete_generic_password(SERVICE, client_id) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == NOT_FOUND => Ok(()),
        Err(_) => Err(GithubError::CredentialStore),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_item(_client_id: &str) -> Result<Option<Vec<u8>>, GithubError> {
    Err(GithubError::CredentialStore)
}

#[cfg(not(target_os = "macos"))]
fn save_item(_client_id: &str, _item: &[u8]) -> Result<(), GithubError> {
    Err(GithubError::CredentialStore)
}

#[cfg(not(target_os = "macos"))]
fn remove_item(_client_id: &str) -> Result<(), GithubError> {
    Err(GithubError::CredentialStore)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_decoding_filters_avatar_and_refuses_corrupt_secrets() {
        let mut item = serde_json::json!({
            "account": {
                "id": "123",
                "login": "score-studio",
                "avatarUrl": "https://outside.test/u/123"
            },
            "tokens": {
                "access_token": "ghu_sample",
                "expires_at": 20000,
                "refresh_token": "ghr_sample",
                "refresh_expires_at": 30000
            }
        });
        let saved = serde_json::to_vec(&item).unwrap();
        let credential = decode(&saved).unwrap();
        assert_eq!(credential.account.login, "score-studio");
        assert_eq!(credential.account.avatar_url, None);
        item["tokens"]["refresh_token"] = serde_json::json!("ghr_bad\r");
        let corrupt = serde_json::to_vec(&item).unwrap();
        assert!(matches!(
            decode(&corrupt),
            Err(GithubError::CredentialStore)
        ));
    }
}
