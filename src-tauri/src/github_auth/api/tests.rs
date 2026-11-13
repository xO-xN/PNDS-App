use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn accept_read(listener: &TcpListener) -> TcpStream {
    let (mut stream, _) = listener.accept().await.unwrap();
    let mut request = Vec::new();
    let mut chunk = [0; 512];
    while !request.ends_with(b"\r\n\r\n") {
        let size = stream.read(&mut chunk).await.unwrap();
        assert!(size > 0 && request.len() + size <= 4096);
        request.extend_from_slice(&chunk[..size]);
    }
    assert!(request.starts_with(b"GET /test HTTP/1.1\r\n"));
    stream
}

#[tokio::test]
async fn rest_read_recovers_after_a_response_timeout() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://{}/test", listener.local_addr().unwrap());
    let client = Client::builder()
        .no_proxy()
        .retry(reqwest::retry::never())
        .build()
        .unwrap();
    let server = tokio::spawn(async move {
        let _unanswered = accept_read(&listener).await;
        let mut second = accept_read(&listener).await;
        second
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntrue")
            .await
            .unwrap();
    });
    let result =
        send_read::<bool>("test read", Duration::from_millis(500), || client.get(&url)).await;
    assert_eq!(result, Ok(true));
    server.await.unwrap();
}

#[tokio::test]
async fn rest_read_returns_rate_limit_without_retrying() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://{}/test", listener.local_addr().unwrap());
    let client = Client::builder()
        .no_proxy()
        .retry(reqwest::retry::never())
        .build()
        .unwrap();
    let server = tokio::spawn(async move {
        let mut stream = accept_read(&listener).await;
        stream
            .write_all(
                b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
    });
    let result = send_read::<bool>("test read", Duration::from_secs(1), || client.get(&url)).await;
    assert_eq!(result, Err(GithubError::RateLimited));
    server.await.unwrap();
}

fn grant(verification_uri: &str) -> DeviceGrantReply {
    serde_json::from_value(serde_json::json!({
        "device_code": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "user_code": "ABCD-EFGH",
        "verification_uri": verification_uri,
        "expires_in": 900,
        "interval": 5
    }))
    .unwrap()
}

#[test]
fn device_verification_stays_on_the_exact_github_endpoint() {
    let valid = grant(DEVICE_VERIFICATION).validate().unwrap();
    assert_eq!(valid.user_code, "ABCD-EFGH");
    assert_eq!(valid.expires_in, 900);
    for bad in [
        "https://github.com.evil.test/login/device",
        "https://github.com/login/device?redirect=https://example.test",
        "https://github.com:443/login/device",
        "http://github.com/login/device",
    ] {
        assert!(matches!(grant(bad).validate(), Err(GithubError::Protocol)));
    }
}

#[test]
fn oauth_polls_follow_github_state_and_discard_provider_diagnostics() {
    for (response, expected) in [
        ("expired_token", GithubError::DeviceExpired),
        ("access_denied", GithubError::AccessDenied),
        ("bad_refresh_token", GithubError::Authentication),
        ("incorrect_client_credentials", GithubError::NotConfigured),
        ("unrecognized secret-like text", GithubError::Protocol),
    ] {
        let reply: TokenReply = serde_json::from_value(serde_json::json!({
            "error": response,
            "error_description": "provider response must not reach the caller"
        }))
        .unwrap();
        assert!(matches!(reply.interpret(1), Ok(OAuthReply::Rejected(error)) if error == expected));
    }
    let pending: TokenReply =
        serde_json::from_value(serde_json::json!({"error": "authorization_pending"})).unwrap();
    assert!(matches!(pending.interpret(1), Ok(OAuthReply::Pending)));
    let slowed: TokenReply =
        serde_json::from_value(serde_json::json!({"error": "slow_down", "interval": 10})).unwrap();
    assert!(matches!(
        slowed.interpret(1),
        Ok(OAuthReply::SlowDown(Some(10)))
    ));
}

#[test]
fn requires_expiring_device_token_pairs_before_persistence() {
    let reply = |access_token, refresh_token_expires_in| {
        serde_json::from_value::<TokenReply>(serde_json::json!({
            "access_token": access_token,
            "expires_in": 28800,
            "refresh_token": "ghr_sample",
            "refresh_token_expires_in": refresh_token_expires_in,
            "token_type": "bearer"
        }))
        .unwrap()
    };
    assert!(
        matches!(reply("ghu_sample", 15897600).interpret(10), Ok(OAuthReply::Token(tokens))
        if tokens.expires_at == 28810 && tokens.refresh_expires_at == 15897610)
    );
    assert!(matches!(
        reply("ghu_with\nline", 15897600).interpret(10),
        Err(GithubError::Protocol)
    ));
    assert!(matches!(
        reply("ghu_sample", 20).interpret(10),
        Err(GithubError::Protocol)
    ));
}

#[test]
fn request_body_keeps_oauth_secrets_out_of_urls() {
    let api = Api::new().unwrap();
    let request = api
        .oauth(
            TOKEN_ENDPOINT,
            &[
                ("refresh_token", "ghr_sample"),
                ("grant_type", "refresh_token"),
            ],
        )
        .build()
        .unwrap();
    assert_eq!(request.url().as_str(), TOKEN_ENDPOINT);
    assert_eq!(
        request
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .unwrap(),
        "application/x-www-form-urlencoded"
    );
    assert_eq!(
        request.body().unwrap().as_bytes().unwrap(),
        b"refresh_token=ghr_sample&grant_type=refresh_token"
    );
}

#[test]
fn repository_names_and_avatars_cannot_redirect_credentials_or_ui() {
    assert!(repository_name("score-studio/.github").is_ok());
    for bad in [
        "https://github.com/score-studio/demo",
        "studio/demo/extra",
        "studio/..",
        "studio/demo?token",
        "studio/demo#abc",
        "studio/demo%2Fextra",
        "studio@example.com/demo",
    ] {
        assert_eq!(repository_name(bad), Err(GithubError::InvalidRepository));
    }
    assert!(valid_avatar(
        "https://avatars.githubusercontent.com/u/345?v=4"
    ));
    for bad in [
        "http://avatars.githubusercontent.com/u/345",
        "https://avatars.githubusercontent.com.evil.test/u/345",
        "https://avatars.githubusercontent.com@evil.test/u/345",
        "https://avatars.githubusercontent.com:444/u/345",
    ] {
        assert!(!valid_avatar(bad));
    }
}

#[test]
fn both_user_and_installation_need_write_permission() {
    let repo = |push, archived| {
        serde_json::from_value::<RepositoryReply>(serde_json::json!({
            "id": 42,
            "full_name": "score-studio/demo",
            "private": true,
            "default_branch": "topic/base",
            "permissions": {"push": push},
            "archived": archived
        }))
        .unwrap()
    };
    assert!(repo(true, false).into_repository(true).unwrap().can_push);
    assert!(!repo(false, false).into_repository(true).unwrap().can_push);
    assert!(!repo(true, false).into_repository(false).unwrap().can_push);
    assert!(!repo(true, true).into_repository(true).unwrap().can_push);
}

#[test]
fn verifies_template_source_by_immutable_repository_id_and_fresh_target_metadata() {
    let expected = GithubRepository {
        id: "42".into(),
        full_name: "score-studio/demo".into(),
        private: true,
        default_branch: "main".into(),
        can_push: true,
    };
    let reply = |id, branch, source| {
        serde_json::json!({
            "id": id,
            "full_name": "Score-Studio/Demo",
            "private": true,
            "default_branch": branch,
            "permissions": {"push": true},
            "template_repository": source,
        })
    };
    let matches = |reply| {
        serde_json::from_value::<TemplateTargetReply>(reply)
            .unwrap()
            .matches(&expected)
    };
    let official = serde_json::json!({"id": 1326767366, "full_name": "xO-xN/PNDS-Template"});
    let imposter = serde_json::json!({"id": 43, "full_name": "xO-xN/PNDS-Template"});
    assert_eq!(matches(reply(42, "main", official.clone())), Ok(true));
    assert_eq!(matches(reply(42, "main", imposter)), Ok(false));
    assert_eq!(
        matches(reply(42, "main", serde_json::Value::Null)),
        Ok(false)
    );
    assert_eq!(
        matches(reply(44, "main", official.clone())),
        Err(GithubError::Conflict)
    );
    assert_eq!(
        matches(reply(42, "different", official.clone())),
        Err(GithubError::Conflict)
    );
    let mut omitted_permissions = reply(42, "main", official);
    omitted_permissions
        .as_object_mut()
        .unwrap()
        .remove("permissions");
    assert_eq!(matches(omitted_permissions.clone()), Ok(true));
    omitted_permissions["permissions"] = serde_json::json!({"push": false});
    assert_eq!(matches(omitted_permissions), Err(GithubError::AccessDenied));
}
