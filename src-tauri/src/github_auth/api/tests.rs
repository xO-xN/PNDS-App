use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn accept_read(listener: &TcpListener) -> TcpStream {
    let (stream, request) = accept_request(listener).await;
    assert!(request.starts_with("GET /test HTTP/1.1\r\n"));
    stream
}

async fn accept_request(listener: &TcpListener) -> (TcpStream, String) {
    let (mut stream, _) = listener.accept().await.unwrap();
    let mut request = Vec::new();
    let mut chunk = [0; 512];
    while !request.ends_with(b"\r\n\r\n") {
        let size = stream.read(&mut chunk).await.unwrap();
        assert!(size > 0 && request.len() + size <= 4096);
        request.extend_from_slice(&chunk[..size]);
    }
    (stream, String::from_utf8(request).unwrap())
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

#[tokio::test]
async fn verifies_private_template_origin_when_anonymous_rest_is_rate_limited() {
    use crate::github_auth::{GithubAccess, GithubAuth};

    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let auth = GithubAuth {
        config: None,
        api: Ok(Api {
            client: Client::builder()
                .no_proxy()
                .retry(reqwest::retry::never())
                .timeout(Duration::from_secs(2))
                .build()
                .unwrap(),
            test_origin: Some(origin),
        }),
        state: Default::default(),
    };
    let expected = GithubRepository {
        id: "42".into(),
        full_name: "score-studio/demo".into(),
        private: true,
        default_branch: "main".into(),
        can_push: true,
    };
    let access = GithubAccess {
        account: GithubAccount {
            id: "1".into(),
            login: "score-studio".into(),
            avatar_url: None,
        },
        token: "ghu_fixture".into(),
    };
    let server = tokio::spawn(async move {
        loop {
            let (mut stream, request) = accept_request(&listener).await;
            let (status, headers, body) = if request.starts_with("GET /repos/score-studio/demo ")
                && request
                    .to_ascii_lowercase()
                    .contains("\r\nauthorization: bearer ghu_fixture\r\n")
            {
                (
                    "200 OK",
                    "",
                    r#"{"id":42,"full_name":"score-studio/demo","private":true,"default_branch":"main","template_repository":{"id":1326767366,"full_name":"xO-xN/PNDS-Template","private":false}}"#,
                )
            } else {
                ("403 Forbidden", "X-RateLimit-Remaining: 0\r\n", "")
            };
            let reply = format!(
                "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(reply.as_bytes()).await.unwrap();
        }
    });
    let result = auth.official_template_source(&access, &expected).await;
    server.abort();
    assert_eq!(result, Ok(true));
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
    let moved = serde_json::json!({"id": 1326767366, "full_name": "xO-xN/Old-PNDS-Template"});
    assert_eq!(matches(reply(42, "main", official.clone())), Ok(true));
    assert_eq!(matches(reply(42, "main", imposter)), Ok(false));
    assert_eq!(matches(reply(42, "main", moved)), Ok(false));
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

#[tokio::test]
async fn creates_the_confirmed_private_repository_from_the_official_template_once() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let api = Api {
        client: Client::builder()
            .no_proxy()
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap(),
        test_origin: Some(format!("http://{}", listener.local_addr().unwrap())),
    };
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let (body_start, body_size) = loop {
            let mut byte = [0];
            stream.read_exact(&mut byte).await.unwrap();
            request.push(byte[0]);
            assert!(request.len() <= 4096);
            if request.ends_with(b"\r\n\r\n") {
                let header = String::from_utf8(request.clone())
                    .unwrap()
                    .to_ascii_lowercase();
                assert!(header.starts_with("post /repos/xo-xn/pnds-template/generate http/1.1"));
                assert!(header.contains("authorization: bearer test-token\r\n"));
                let length = header
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: ")?.parse::<usize>().ok())
                    .unwrap();
                break (request.len(), length);
            }
        };
        request.resize(body_start + body_size, 0);
        stream.read_exact(&mut request[body_start..]).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&request[body_start..]).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "owner": "score-studio",
                "name": "my-score",
                "private": true,
                "include_all_branches": false,
            })
        );
        let body = r#"{"id":42,"full_name":"score-studio/my-score","private":true,"default_branch":"main"}"#;
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), listener.accept())
                .await
                .is_err()
        );
    });
    let repository = api
        .generate_template("test-token", "score-studio", "my-score", true)
        .await
        .unwrap();
    assert_eq!(repository.id, "42");
    assert_eq!(repository.full_name, "score-studio/my-score");
    assert!(repository.private);
    assert!(!repository.can_push);
    server.await.unwrap();
}

#[tokio::test]
async fn creation_owners_require_both_permissions_even_for_selected_installations() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let api = Api {
        client: Client::builder().no_proxy().build().unwrap(),
        test_origin: Some(format!("http://{}", listener.local_addr().unwrap())),
    };
    let server = tokio::spawn(async move {
        let (mut stream, request) = accept_request(&listener).await;
        assert!(request.starts_with("GET /user/installations?per_page=100&page=1 HTTP/1.1"));
        let body = r#"{"installations":[
            {"id":1,"account":{"login":"composer"},"permissions":{"repository_creation":"write","contents":"write"},"repository_selection":"selected"},
            {"id":2,"account":{"login":"studio"},"permissions":{"repository_creation":"write","contents":"write"}},
            {"id":3,"account":{"login":"needs-upgrade"},"permissions":{"contents":"write"}},
            {"id":4,"account":{"login":"read-only"},"permissions":{"repository_creation":"write","contents":"read"}},
            {"id":5,"account":{"login":"suspended"},"permissions":{"repository_creation":"write","contents":"write"},"suspended_at":"2026-11-13T00:00:00Z"}
        ]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
    });
    assert_eq!(
        api.creation_owners("test-token").await.unwrap(),
        vec!["composer".to_owned(), "studio".to_owned()]
    );
    server.await.unwrap();
}
