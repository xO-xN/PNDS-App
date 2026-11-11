use super::*;

fn pending() -> (PendingDevice, GithubDeviceCode, Instant) {
    let now = Instant::now();
    let (pending, code) = PendingDevice::new(
        DeviceGrant {
            device_code: "private-device-code".to_owned(),
            user_code: "ABCD-EFGH".to_owned(),
            expires_in: 900,
            interval: 5,
        },
        now,
    )
    .unwrap();
    (pending, code, now)
}

#[test]
fn device_code_ipc_payload_excludes_provider_device_secret() {
    let (pending, public, _) = pending();
    let json = serde_json::to_value(&public).unwrap();
    assert_eq!(json["userCode"], "ABCD-EFGH");
    assert_eq!(json["verificationUrl"], api::DEVICE_VERIFICATION);
    assert_eq!(json["intervalSecs"], 5);
    assert_eq!(json["expiresInSecs"], 900);
    assert_eq!(json["id"], pending.id);
    assert_ne!(json["id"], pending.device_code);
    assert!(!json.to_string().contains(&pending.device_code));
}

#[test]
fn device_poll_rounds_remaining_seconds_up_and_honors_slow_down() {
    let (mut pending, _, now) = pending();
    assert_eq!(pending.remaining_interval(now), 5);
    let later = now + Duration::from_millis(4950);
    assert_eq!(pending.remaining_interval(later), 1);
    pending.slow_down(Some(12), later);
    assert_eq!(pending.remaining_interval(later), 12);
    pending.slow_down(Some(7), later);
    assert_eq!(pending.remaining_interval(later), 17);
    assert_eq!(
        pending.remaining_interval(later + Duration::from_secs(17)),
        0
    );
}

#[tokio::test]
async fn early_and_stale_poll_requests_do_not_need_a_network_client() {
    let (pending, public, _) = pending();
    let auth = GithubAuth {
        config: Config::parse("Iv1.dev".to_owned(), "pnds-app"),
        api: Err(GithubError::Network),
        state: Arc::new(Mutex::new(AuthState {
            pending: Some(pending),
            rotated: None,
        })),
    };
    assert_eq!(auth.poll("older-id").await, Err(GithubError::DeviceExpired));
    assert!(matches!(
        auth.poll(&public.id).await,
        Ok(GithubAuthPoll::Pending {
            interval_secs: 1..=5
        })
    ));
}

#[test]
fn install_slug_stays_in_a_single_github_path_segment() {
    let config = Config::parse("Iv1.dev".to_owned(), "pnds-app").unwrap();
    assert_eq!(
        config.installation_url,
        "https://github.com/apps/pnds-app/installations/new"
    );
    assert!(Config::parse("Iv1.dev".to_owned(), "pnds/../../login").is_none());
    assert!(Config::parse("Iv1.dev?anything".to_owned(), "pnds-app").is_none());
}
