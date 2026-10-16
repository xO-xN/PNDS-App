use super::*;
use crate::types::ModelServiceConfig;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct MemoryCredentials {
    value: Arc<Mutex<Option<String>>>,
    fail: Arc<Mutex<bool>>,
}

#[derive(Clone)]
struct MetadataOnlyCredentials;

impl CredentialStore for MetadataOnlyCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        Ok(true)
    }
    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        Err(ModelServiceError::CredentialStore)
    }
    fn save(&self, _key: &str) -> Result<(), ModelServiceError> {
        Ok(())
    }
    fn remove(&self) -> Result<(), ModelServiceError> {
        Ok(())
    }
}

#[tokio::test]
async fn opening_settings_can_report_a_saved_item_without_decrypting_the_key() {
    let service = ModelService::new(MetadataOnlyCredentials);
    assert_eq!(
        service.credential_status().await,
        Ok(ModelCredentialStatus { has_key: true })
    );
}

impl CredentialStore for MemoryCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        if *self.fail.lock().unwrap() {
            return Err(ModelServiceError::CredentialStore);
        }
        Ok(self.value.lock().unwrap().is_some())
    }
    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        if *self.fail.lock().unwrap() {
            return Err(ModelServiceError::CredentialStore);
        }
        Ok(self.value.lock().unwrap().clone())
    }

    fn save(&self, key: &str) -> Result<(), ModelServiceError> {
        if *self.fail.lock().unwrap() {
            return Err(ModelServiceError::CredentialStore);
        }
        *self.value.lock().unwrap() = Some(key.to_string());
        Ok(())
    }

    fn remove(&self) -> Result<(), ModelServiceError> {
        if *self.fail.lock().unwrap() {
            return Err(ModelServiceError::CredentialStore);
        }
        *self.value.lock().unwrap() = None;
        Ok(())
    }
}

#[derive(Clone)]
struct BlockingCredentials {
    memory: MemoryCredentials,
    entered: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    release: Arc<Mutex<std::sync::mpsc::Receiver<()>>>,
}

impl CredentialStore for BlockingCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        self.memory.contains()
    }
    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        self.memory.read()
    }
    fn save(&self, key: &str) -> Result<(), ModelServiceError> {
        if let Some(entered) = self.entered.lock().unwrap().take() {
            let _ = entered.send(());
        }
        self.release.lock().unwrap().recv().unwrap();
        self.memory.save(key)
    }
    fn remove(&self) -> Result<(), ModelServiceError> {
        self.memory.remove()
    }
}

#[tokio::test]
async fn pending_save_cannot_restore_a_credential_after_later_remove_completes() {
    for cancel_save in [false, true] {
        let (entered, started) = tokio::sync::oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let service = Arc::new(ModelService::new(BlockingCredentials {
            memory: MemoryCredentials::default(),
            entered: Arc::new(Mutex::new(Some(entered))),
            release: Arc::new(Mutex::new(blocked)),
        }));
        let saving = service.clone();
        let save = tokio::spawn(async move { saving.save_credential("old-secret").await });
        started.await.unwrap();
        if cancel_save {
            save.abort();
        }
        let removing = service.clone();
        let mut remove = tokio::spawn(async move { removing.remove_credential().await });
        let pending = tokio::time::timeout(std::time::Duration::from_millis(100), &mut remove)
            .await
            .is_err();
        release.send(()).unwrap();
        if cancel_save {
            assert!(save.await.unwrap_err().is_cancelled());
        } else {
            save.await.unwrap().unwrap();
        }
        if pending {
            remove.await.unwrap().unwrap();
        }
        assert!(
            pending,
            "remove must wait for the older native save, including a cancelled caller"
        );
        assert!(!service.credential_status().await.unwrap().has_key);
    }
}

#[tokio::test]
async fn credentials_report_failed_mutations_without_disclosing_the_key() {
    let store = MemoryCredentials::default();
    let service = ModelService::new(store.clone());
    assert!(!service.credential_status().await.unwrap().has_key);
    *store.fail.lock().unwrap() = true;
    assert_eq!(
        service.save_credential("secret-first").await,
        Err(ModelServiceError::CredentialStore)
    );
    *store.fail.lock().unwrap() = false;
    assert!(!service.credential_status().await.unwrap().has_key);
    service.save_credential("secret-first").await.unwrap();
    assert_eq!(
        serde_json::to_value(service.credential_status().await.unwrap()).unwrap(),
        serde_json::json!({"hasKey": true})
    );
    *store.fail.lock().unwrap() = true;
    assert_eq!(
        service.save_credential("secret-replacement").await,
        Err(ModelServiceError::CredentialStore)
    );
    assert_eq!(
        service.remove_credential().await,
        Err(ModelServiceError::CredentialStore)
    );
    assert_eq!(
        service.credential_status().await,
        Err(ModelServiceError::CredentialStore)
    );
    *store.fail.lock().unwrap() = false;
    assert!(service.credential_status().await.unwrap().has_key);
    service.save_credential("secret-replacement").await.unwrap();
    service.remove_credential().await.unwrap();
    assert!(!service.credential_status().await.unwrap().has_key);
    service.remove_credential().await.unwrap();
}

async fn http_stub(
    responses: Vec<(u16, String)>,
) -> (
    ModelServiceConfig,
    tokio::task::JoinHandle<Vec<(String, Value)>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "requested-model".into(),
    };
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            requests.push(read_http_request(&mut socket).await);
            let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    (config, task)
}

async fn read_http_request(socket: &mut tokio::net::TcpStream) -> (String, Value) {
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0; 1024];
        let count = socket.read(&mut chunk).await.unwrap();
        assert!(count > 0);
        buffer.extend_from_slice(&chunk[..count]);
        if let Some(position) = buffer.windows(4).position(|part| part == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let headers = String::from_utf8(buffer[..header_end].to_vec()).unwrap();
    let length: usize = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length: ")
                .map(str::to_owned)
        })
        .unwrap()
        .parse()
        .unwrap();
    while buffer.len() < header_end + length {
        let mut chunk = [0; 1024];
        let count = socket.read(&mut chunk).await.unwrap();
        assert!(count > 0);
        buffer.extend_from_slice(&chunk[..count]);
    }
    (
        headers,
        serde_json::from_slice(&buffer[header_end..header_end + length]).unwrap(),
    )
}

fn text_response() -> (u16, String) {
    (200, json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"Connection is working."}}]}).to_string())
}

fn tool_response() -> (u16, String) {
    (200, json!({"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"call-probe","type":"function","function":{"name":"pnds_connection_probe","arguments":"{\"value\":\"pnds-connection-check\"}"}}]}}]}).to_string())
}

#[tokio::test]
async fn saved_and_entered_keys_send_identical_probe_requests_after_service_recreation() {
    let store = MemoryCredentials::default();
    let service = ModelService::new(store.clone());
    service.save_credential("fixture-secret").await.unwrap();
    let (config, entered_server) =
        http_stub(vec![text_response(), tool_response(), text_response()]).await;
    service
        .test_connection(&config, Some("fixture-secret"))
        .await
        .unwrap();
    let entered = entered_server.await.unwrap();
    let reopened = ModelService::new(store);
    let (config, saved_server) =
        http_stub(vec![text_response(), tool_response(), text_response()]).await;
    reopened.test_connection(&config, None).await.unwrap();
    let saved = saved_server.await.unwrap();
    for ((entered_headers, entered_body), (saved_headers, saved_body)) in entered.iter().zip(&saved)
    {
        for headers in [entered_headers, saved_headers] {
            assert!(headers
                .to_ascii_lowercase()
                .contains("authorization: bearer fixture-secret\r\n"));
        }
        assert_eq!(entered_body, saved_body);
    }
    assert_eq!(entered.len(), 3);
    assert_eq!(saved.len(), 3);
}

#[tokio::test]
async fn connection_test_uses_selected_model_and_completes_a_real_tool_round_trip() {
    let (config, server) = http_stub(vec![text_response(), tool_response(), text_response()]).await;
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("stored-secret").await.unwrap();
    let report = service
        .test_connection(&config, Some("draft-secret"))
        .await
        .unwrap();
    assert!(report.text && report.tool_call);
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), 3);
    for (headers, body) in &requests {
        assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer draft-secret"));
        assert_eq!(body["model"], "requested-model");
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_tokens"], 128);
        assert!(!body.to_string().contains("stored-secret"));
        assert!(!body.to_string().contains("draft-secret"));
        assert!(!body.to_string().contains("project"));
    }
    assert!(requests[0].1.get("tools").is_none());
    assert_eq!(
        requests[1].1["tools"][0]["function"]["name"],
        "pnds_connection_probe"
    );
    let messages = requests[2].1["messages"].as_array().unwrap();
    assert_eq!(
        messages[messages.len() - 2]["tool_calls"][0]["id"],
        "call-probe"
    );
    assert_eq!(messages.last().unwrap()["role"], "tool");
    assert_eq!(messages.last().unwrap()["tool_call_id"], "call-probe");
    assert_eq!(
        serde_json::from_str::<Value>(messages.last().unwrap()["content"].as_str().unwrap())
            .unwrap(),
        json!({"value":"pnds-connection-check","ok":true})
    );
}

#[tokio::test]
async fn truncated_completions_are_not_reported_as_connection_success() {
    let mut truncated: Value = serde_json::from_str(&text_response().1).unwrap();
    truncated["choices"][0]["finish_reason"] = json!("length");
    let (config, server) = http_stub(vec![
        (200, truncated.to_string()),
        tool_response(),
        text_response(),
    ])
    .await;
    let service = ModelService::new(MemoryCredentials::default());
    let result = service.test_connection(&config, Some("test-secret")).await;
    server.abort();
    assert_eq!(result, Err(ModelServiceError::Protocol));
}

#[tokio::test]
async fn failed_replacement_and_removal_leave_previous_credential_usable() {
    let store = MemoryCredentials::default();
    let service = ModelService::new(store.clone());
    service.save_credential("previous-secret").await.unwrap();
    *store.fail.lock().unwrap() = true;
    assert_eq!(
        service.save_credential("replacement-secret").await,
        Err(ModelServiceError::CredentialStore)
    );
    assert_eq!(
        service.remove_credential().await,
        Err(ModelServiceError::CredentialStore)
    );
    *store.fail.lock().unwrap() = false;
    let (config, server) = http_stub(vec![text_response(), tool_response(), text_response()]).await;
    service.test_connection(&config, None).await.unwrap();
    for (headers, _) in server.await.unwrap() {
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer previous-secret"));
        assert!(!headers.contains("replacement-secret"));
    }
}

#[tokio::test]
async fn saved_credential_replacement_and_explicit_draft_use_the_requested_key() {
    let store = MemoryCredentials::default();
    let service = ModelService::new(store.clone());
    service.save_credential("previous-secret").await.unwrap();
    service.save_credential("replacement-secret").await.unwrap();
    let (config, server) = http_stub(vec![text_response(), tool_response(), text_response()]).await;
    service.test_connection(&config, None).await.unwrap();
    for (headers, _) in server.await.unwrap() {
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer replacement-secret"));
    }
    *store.fail.lock().unwrap() = true;
    let (config, server) = http_stub(vec![text_response(), tool_response(), text_response()]).await;
    service
        .test_connection(&config, Some("draft-secret"))
        .await
        .unwrap();
    for (headers, _) in server.await.unwrap() {
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer draft-secret"));
    }
}

#[tokio::test]
async fn invalid_config_and_missing_credentials_fail_before_network_io() {
    let store = MemoryCredentials::default();
    let service = ModelService::new(store.clone());
    for base_url in [
        "https://user:password@example.test/v1",
        "https://example.test/v1?key=secret",
        "https://example.test/v1#secret",
        "http://example.test/v1",
        "file:///etc/passwd",
        " https://example.test/v1",
        "https://example.test/v1\n",
    ] {
        let config = ModelServiceConfig {
            context: None,
            base_url: base_url.into(),
            model: "model".into(),
        };
        assert_eq!(
            service.test_connection(&config, None).await,
            Err(ModelServiceError::InvalidConfig)
        );
    }
    let config = ModelServiceConfig {
        context: None,
        base_url: "https://example.test/v1".into(),
        model: "model".into(),
    };
    assert_eq!(
        service.test_connection(&config, None).await,
        Err(ModelServiceError::MissingCredential)
    );
    for key in ["", " ", "secret\r\nX-Other: injected"] {
        assert!(service.save_credential(key).await.is_err());
    }
    assert!(!service.credential_status().await.unwrap().has_key);
    *store.fail.lock().unwrap() = true;
    assert_eq!(
        service.test_connection(&config, None).await,
        Err(ModelServiceError::CredentialStore)
    );
}

#[tokio::test]
async fn http_failures_are_actionable_and_never_echo_service_errors_or_credentials() {
    for (status, expected) in [
        (401, ModelServiceError::Authentication),
        (403, ModelServiceError::Authentication),
        (429, ModelServiceError::RateLimited),
        (503, ModelServiceError::ServiceUnavailable),
        (404, ModelServiceError::Protocol),
    ] {
        let (config, server) = http_stub(vec![(
            status,
            "echoed-api-secret and confidential error payload".into(),
        )])
        .await;
        let service = ModelService::new(MemoryCredentials::default());
        let error = service
            .test_connection(&config, Some("echoed-api-secret"))
            .await
            .unwrap_err();
        assert_eq!(error, expected);
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("confidential"));
        assert_eq!(server.await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn unsupported_tools_are_distinct_from_bad_protocol() {
    for reply in [
        text_response(),
        (400, "unsupported tools".into()),
        (422, "unsupported tool_choice".into()),
    ] {
        let (config, server) = http_stub(vec![text_response(), reply]).await;
        let service = ModelService::new(MemoryCredentials::default());
        assert_eq!(
            service.test_connection(&config, Some("test-secret")).await,
            Err(ModelServiceError::ToolsUnsupported)
        );
        assert_eq!(server.await.unwrap().len(), 2);
    }
}

#[tokio::test]
async fn malformed_unknown_and_repeated_tool_calls_never_execute_or_continue() {
    let normal: Value = serde_json::from_str(&tool_response().1).unwrap();
    let mut wrong_name = normal.clone();
    wrong_name["choices"][0]["message"]["tool_calls"][0]["function"]["name"] =
        json!("read_project_file");
    let mut bad_arguments = normal.clone();
    bad_arguments["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] =
        json!("{\"value\":\"unexpected\",\"path\":\"secret\"}");
    let mut repeated = normal.clone();
    repeated["choices"][0]["message"]["tool_calls"] = json!([
        normal["choices"][0]["message"]["tool_calls"][0],
        normal["choices"][0]["message"]["tool_calls"][0]
    ]);
    for reply in [wrong_name, bad_arguments, repeated] {
        let (config, server) = http_stub(vec![text_response(), (200, reply.to_string())]).await;
        let service = ModelService::new(MemoryCredentials::default());
        assert_eq!(
            service.test_connection(&config, Some("test-secret")).await,
            Err(ModelServiceError::Protocol)
        );
        assert_eq!(server.await.unwrap().len(), 2);
    }
}

#[tokio::test]
async fn empty_malformed_and_oversized_responses_do_not_count_as_text_support() {
    for body in [
        "{}".into(),
        "not-json".into(),
        "x".repeat(64 * 1024 + 1),
        json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":""}}]})
            .to_string(),
    ] {
        let (config, server) = http_stub(vec![(200, body)]).await;
        let service = ModelService::new(MemoryCredentials::default());
        assert_eq!(
            service.test_connection(&config, Some("test-secret")).await,
            Err(ModelServiceError::Protocol)
        );
        assert_eq!(server.await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn a_repeated_tool_request_after_the_result_is_not_a_successful_round_trip() {
    let (config, server) = http_stub(vec![text_response(), tool_response(), tool_response()]).await;
    let service = ModelService::new(MemoryCredentials::default());
    assert_eq!(
        service.test_connection(&config, Some("test-secret")).await,
        Err(ModelServiceError::Protocol)
    );
    assert_eq!(server.await.unwrap().len(), 3);
}

#[tokio::test]
async fn disconnected_server_is_a_network_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "model".into(),
    };
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        drop(socket);
    });
    let service = ModelService::new(MemoryCredentials::default());
    assert_eq!(
        service.test_connection(&config, Some("test-secret")).await,
        Err(ModelServiceError::Network)
    );
    server.await.unwrap();
}

#[tokio::test]
async fn unresponsive_server_reaches_the_bounded_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "model".into(),
    };
    let server = tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    let service = ModelService::new(MemoryCredentials::default());
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(35),
        service.test_connection(&config, Some("test-secret")),
    )
    .await;
    server.abort();
    assert_eq!(outcome.unwrap(), Err(ModelServiceError::Timeout));
}

#[tokio::test]
async fn redirects_never_forward_the_credential_to_another_endpoint() {
    let trap = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "model".into(),
    };
    let location = format!("http://{}/stolen", trap.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(socket.read(&mut buffer).await.unwrap() > 0);
        socket.write_all(format!("HTTP/1.1 307 Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    });
    let service = ModelService::new(MemoryCredentials::default());
    assert_eq!(
        service.test_connection(&config, Some("test-secret")).await,
        Err(ModelServiceError::Protocol)
    );
    server.await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), trap.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn chunked_responses_without_a_content_length_are_also_bounded() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "model".into(),
    };
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(socket.read(&mut buffer).await.unwrap() > 0);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        let body = "x".repeat(64 * 1024 + 1);
        // The client may close as soon as the byte budget is exhausted.
        let _ = socket
            .write_all(format!("{:X}\r\n{body}\r\n0\r\n\r\n", body.len()).as_bytes())
            .await;
    });
    let service = ModelService::new(MemoryCredentials::default());
    assert_eq!(
        service.test_connection(&config, Some("test-secret")).await,
        Err(ModelServiceError::Protocol)
    );
    server.await.unwrap();
}

#[tokio::test]
async fn assistant_session_keeps_one_config_and_document_tools_across_turns() {
    let mut tool: Value = serde_json::from_str(&tool_response().1).unwrap();
    tool["choices"][0]["message"]["tool_calls"][0]["function"] =
        json!({"name":"search_help","arguments":"{\"query\":\"monitor\"}"});
    let (config, server) = http_stub(vec![(200, tool.to_string()), text_response()]).await;
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("assistant-secret").await.unwrap();
    let request = service
        .begin_assistant(
            "project-a".into(),
            "request-a".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    let mut messages: Vec<AssistantModelMessage> = serde_json::from_value(json!([
        {"role":"system","content":"Answer using installed help."},
        {"role":"user","content":"How does monitor work?"}
    ]))
    .unwrap();
    let first = service
        .assistant_turn(&request.request_id, messages.clone(), |_| {})
        .await
        .unwrap();
    assert_eq!(first.tool_calls[0].name, "search_help");
    messages.push(
        serde_json::from_value(
            json!({"role":"assistant","content":null,"toolCalls":first.tool_calls}),
        )
        .unwrap(),
    );
    messages.push(
        serde_json::from_value(
            json!({"role":"tool","content":"Installed help section","toolCallId":"call-probe"}),
        )
        .unwrap(),
    );
    let final_turn = service
        .assistant_turn(&request.request_id, messages, |_| {})
        .await
        .unwrap();
    assert_eq!(final_turn.text.as_deref(), Some("Connection is working."));
    for (headers, body) in server.await.unwrap() {
        assert!(headers
            .to_ascii_lowercase()
            .contains("authorization: bearer assistant-secret"));
        assert_eq!(body["model"], "requested-model");
        assert_eq!(body["tools"].as_array().unwrap().len(), 2);
        assert_eq!(body["tools"][0]["function"]["name"], "search_help");
        assert_eq!(body["tools"][1]["function"]["name"], "read_help_section");
        assert!(!body.to_string().contains("project-a"));
    }
}

#[tokio::test]
async fn context_configuration_limits_the_actual_request_and_rejects_contradictory_reserves() {
    let (mut config, server) = http_stub(vec![text_response()]).await;
    let configured = |capacity, output| {
        json!({
            "capacity":capacity,"inputTarget":12000,"maxOutput":output,
            "reasoningReserve":256,"safetyMargin":128,"tokenizer":"cl100kBase",
            "source":"manualUnverified"
        })
    };
    let mut value = serde_json::to_value(&config).unwrap();
    value["context"] = configured(16000, 512);
    config = serde_json::from_value(value.clone()).unwrap();
    validate_config(&config).unwrap();
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("fixture-secret").await.unwrap();
    let session = service
        .begin_assistant(
            "owner".into(),
            "budget-test".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    service
        .assistant_turn(&session.request_id, assistant_question(), |_| {})
        .await
        .unwrap();
    let requests = server.await.unwrap();
    assert_eq!(requests[0].1["max_completion_tokens"], 768);
    assert!(requests[0].1.get("max_tokens").is_none());
    value["context"] = configured(512, 512);
    let invalid = serde_json::from_value(value).unwrap();
    assert_eq!(
        validate_config(&invalid),
        Err(ModelServiceError::InvalidConfig)
    );
}

#[tokio::test]
async fn a_small_input_target_rejects_tools_before_any_http_request_even_without_a_tokenizer() {
    let (config, server) = http_stub(vec![text_response()]).await;
    let mut value = serde_json::to_value(config).unwrap();
    value["context"] = json!({"capacity":null,"inputTarget":100,"maxOutput":64,"reasoningReserve":0,"safetyMargin":0,"tokenizer":"unknown","source":"manualUnverified"});
    let config: ModelServiceConfig = serde_json::from_value(value).unwrap();
    let measurement = measure_context(config.clone(), assistant_question()).unwrap();
    assert!(measurement.estimated_tokens.is_none());
    let display = serde_json::to_value(&measurement).unwrap()["referenceEstimatedTokens"]
        .as_u64()
        .expect("unknown tokenizers still provide a portable display estimate");
    assert!(display > 0 && display < u64::from(measurement.utf8_bytes));
    assert_eq!(measurement.admission_estimate, measurement.utf8_bytes);
    assert_eq!(measurement.exceeded.as_deref(), Some("contextTokens"));
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("fixture-secret").await.unwrap();
    let session = service
        .begin_assistant(
            "owner".into(),
            "small-test".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    assert!(matches!(
        service
            .assistant_turn(&session.request_id, assistant_question(), |_| {})
            .await,
        Err(ModelServiceError::ContextTokensExceeded)
    ));
    assert!(!server.is_finished());
    server.abort();
}

#[test]
fn reference_context_estimates_are_provider_independent_and_leave_budgets_conservative() {
    for model in ["glm-5.3-flash", "another-provider-model"] {
        let mut value = json!({
            "baseUrl":"https://model.example/v1", "model":model,
            "context":{"capacity":1_000_000,"inputTarget":32000,"maxOutput":4096,
            "reasoningReserve":0,"safetyMargin":256,"tokenizer":"unknown","source":"manualUnverified"}
        });
        let messages = serde_json::from_value(json!([
            {"role":"system","content":"Use installed documentation."},
            {"role":"user","content":"中文 English const x = 1; 🎵"}
        ]))
        .unwrap();
        let unknown =
            measure_context(serde_json::from_value(value.clone()).unwrap(), messages).unwrap();
        value["context"]["tokenizer"] = json!("o200kBase");
        let selected = measure_context(
            serde_json::from_value(value).unwrap(),
            serde_json::from_value(json!([
                {"role":"system","content":"Use installed documentation."},
                {"role":"user","content":"中文 English const x = 1; 🎵"}
            ]))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            unknown.reference_estimated_tokens,
            selected.estimated_tokens
        );
        assert!(unknown
            .reference_estimated_tokens
            .is_some_and(|count| count > 0));
        assert!(unknown.estimated_tokens.is_none());
        assert_eq!(unknown.admission_estimate, unknown.utf8_bytes);
        assert!(selected.reference_estimated_tokens.is_none());
        assert_eq!(unknown.capacity, Some(1_000_000));
    }
}

#[tokio::test]
async fn assistant_preserves_json_usage_without_inventing_missing_statistics() {
    let mut response: Value = serde_json::from_str(&text_response().1).unwrap();
    response["usage"] = json!({"prompt_tokens":1234,"completion_tokens":56,"prompt_tokens_details":{"cached_tokens":100},"completion_tokens_details":{"reasoning_tokens":8}});
    let (config, server) = http_stub(vec![(200, response.to_string()), text_response()]).await;
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("fixture-secret").await.unwrap();
    let session = service
        .begin_assistant(
            "owner".into(),
            "usage-test".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    let first = service
        .assistant_turn(&session.request_id, assistant_question(), |_| {})
        .await
        .unwrap();
    let first = serde_json::to_value(first).unwrap();
    assert_eq!(first["usage"]["inputTokens"], 1234);
    assert_eq!(first["usage"]["outputTokens"], 56);
    assert_eq!(first["usage"]["cachedInputTokens"], 100);
    assert_eq!(first["usage"]["reasoningTokens"], 8);
    let second = service
        .assistant_turn(&session.request_id, assistant_question(), |_| {})
        .await
        .unwrap();
    assert!(serde_json::to_value(second).unwrap()["usage"].is_null());
    assert_eq!(server.await.unwrap().len(), 2);
}

#[tokio::test]
async fn assistant_keeps_usage_from_the_stream_tail_without_a_second_request() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "fixture".into(),
        context: None,
    };
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let (_, request) = read_http_request(&mut socket).await;
        assert_eq!(request["stream_options"]["include_usage"], true);
        let body = format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"index":0,"delta":{"content":"回答"},"finish_reason":"stop"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":45,"completion_tokens":6}})
        );
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("fixture-secret").await.unwrap();
    let session = service
        .begin_assistant(
            "owner".into(),
            "tail-test".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    let turn = service
        .assistant_turn(&session.request_id, assistant_question(), |_| {})
        .await
        .unwrap();
    let usage = turn.usage.unwrap();
    assert_eq!(usage.input_tokens, Some(45));
    assert_eq!(usage.output_tokens, Some(6));
    assert!(usage.cached_input_tokens.is_none());
    server.await.unwrap();
}

#[test]
fn context_preview_keeps_empty_input_and_history_categories_distinct() {
    let config = ModelServiceConfig {
        base_url: "https://fixture.example/v1".into(),
        model: "fixture".into(),
        context: None,
    };
    let messages = serde_json::from_value(json!([
        {"role":"system","content":"Policy"},
        {"role":"user","content":"历史问题","contextKind":"history"},
        {"role":"assistant","content":"Historical answer","contextKind":"history"}
    ]))
    .unwrap();
    let measured = measure_context(config, messages).unwrap();
    let part = |kind: &str| {
        measured
            .parts
            .iter()
            .find(|part| part.kind == kind)
            .unwrap()
    };
    assert_eq!(part("input").characters, 0);
    assert_eq!(part("documents").characters, 0);
    assert!(part("history").utf8_bytes > part("history").characters);
    assert!(part("policyTools").utf8_bytes > 100);
}

#[tokio::test]
async fn document_flow_comparison_replays_recorded_packets_through_the_native_service() {
    let evidence: Value = serde_json::from_str(include_str!(
        "../../../docs/acceptance/evidence/235-document-flow-packets.json"
    ))
    .unwrap();
    let cases = evidence["cases"].as_array().unwrap();
    let count = cases
        .iter()
        .flat_map(|case| {
            ["before", "after"].map(|phase| case[phase]["packets"].as_array().unwrap().len())
        })
        .sum();
    let mut response: Value = serde_json::from_str(&text_response().1).unwrap();
    response["usage"] = json!({"prompt_tokens":123,"completion_tokens":11});
    let (mut config, server) = http_stub(vec![(200, response.to_string()); count]).await;
    config.model = "fixture-model".into();
    config.context = Some(serde_json::from_value(evidence["config"]["context"].clone()).unwrap());
    let service = ModelService::new(MemoryCredentials::default());
    service
        .save_credential("controlled-replay-only")
        .await
        .unwrap();
    let mut reports = Vec::new();
    for case in cases {
        let mut report = json!({"id":case["id"]});
        for phase in ["before", "after"] {
            let id = format!("benchmark-{}-{phase}", case["id"].as_str().unwrap());
            let session = service
                .begin_assistant(
                    "fixture-owner".into(),
                    id,
                    config.clone(),
                    service.assistant_revision(),
                )
                .await
                .unwrap();
            let mut calls = Vec::new();
            for packet in case[phase]["packets"].as_array().unwrap() {
                let turn = match service
                    .assistant_turn(
                        &session.request_id,
                        serde_json::from_value(packet.clone()).unwrap(),
                        |_| {},
                    )
                    .await
                {
                    Ok(turn) => turn,
                    Err(error) => {
                        server.abort();
                        panic!("recorded {} {phase} failed: {error:?}", case["id"]);
                    }
                };
                calls.push(
                    json!({"measurement":turn.measurement,"syntheticServerUsage":turn.usage}),
                );
            }
            service.cancel_assistant(&session.request_id);
            report[phase] = json!({"calls":calls,"failure":case[phase]["failure"]});
        }
        reports.push(report);
    }
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), count);
    assert!(requests
        .iter()
        .all(|(_, body)| body["model"] == "fixture-model" && body["max_tokens"] == 512));
    let follow = reports
        .iter()
        .find(|report| report["id"] == "follow-up")
        .unwrap();
    let final_tokens = |phase: &str| {
        follow[phase]["calls"].as_array().unwrap().last().unwrap()["measurement"]["estimatedTokens"]
            .as_u64()
            .unwrap()
    };
    assert!(final_tokens("after") < final_tokens("before"));
    if std::env::var("PNDS_DOCUMENT_CAPTURE").as_deref() == Ok("1") {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../docs/acceptance/evidence/235-native-replay.json");
        std::fs::write(path, serde_json::to_vec_pretty(&json!({"version":1,"note":"Same native request assembly, loopback fixture model and budget for both document flows. Token counts estimate serialized framing; server usage is synthetic, not paid-service evidence.","config":evidence["config"],"cases":reports})).unwrap()).unwrap();
    }
}

fn assistant_question() -> Vec<AssistantModelMessage> {
    serde_json::from_value(json!([{"role":"user","content":"Explain monitor."}])).unwrap()
}

#[tokio::test]
async fn assistant_reply_can_take_longer_than_the_connection_probe_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
        model: "model".into(),
    };
    let (received, accepted) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        assert!(socket.read(&mut bytes).await.unwrap() > 0);
        received.send(()).unwrap();
        released.await.unwrap();
        let body = text_response().1;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    let service = Arc::new(ModelService::new(MemoryCredentials::default()));
    service.save_credential("fixture-secret").await.unwrap();
    let request = service
        .begin_assistant(
            "project-a".into(),
            "slow-reply".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    let sending = service.clone();
    let turn = tokio::spawn(async move {
        sending
            .assistant_turn(&request.request_id, assistant_question(), |_| {})
            .await
    });
    accepted.await.unwrap();
    tokio::time::pause();
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    tokio::task::yield_now().await;
    tokio::time::resume();
    release.send(()).unwrap();
    let result = turn.await.unwrap();
    server.await.unwrap();
    assert!(
        result.is_ok(),
        "a reply within the 120-second assistant budget must not use the 30-second probe deadline: {:?}",
        result.err()
    );
}

#[tokio::test]
async fn assistant_stream_delivers_text_before_completion_and_retains_cancellation_and_deadlines() {
    for action in ["complete", "truncated", "cancel", "deadline"] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ModelServiceConfig {
            context: None,
            base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
            model: "model".into(),
        };
        let (release, released) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let (_, body) = read_http_request(&mut socket).await;
            assert_eq!(body["stream"], true);
            assert_eq!(body["tools"].as_array().unwrap().len(), 2);
            let prefix = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"第一段\",\"reasoning_content\":\"hidden\"},\"finish_reason\":null}]}\n\n";
            socket.write_all(prefix.as_bytes()).await.unwrap();
            released.await.unwrap();
            if action != "truncated" {
                let _ = socket.write_all(b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\" second\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").await;
            }
        });
        let service = Arc::new(ModelService::new(MemoryCredentials::default()));
        service.save_credential("fixture-secret").await.unwrap();
        let request = service
            .begin_assistant(
                "project-a".into(),
                "stream".into(),
                config,
                service.assistant_revision(),
            )
            .await
            .unwrap();
        // Time spent between document/model turns counts against the same budget.
        if action == "deadline" {
            tokio::time::pause();
            tokio::time::advance(std::time::Duration::from_secs(90)).await;
            tokio::time::resume();
        }
        let progress = Arc::new(Mutex::new(Vec::new()));
        let recorded = progress.clone();
        let (arrived, partial) = tokio::sync::oneshot::channel();
        let mut arrived = Some(arrived);
        let sending = service.clone();
        let turn = tokio::spawn(async move {
            sending
                .assistant_turn(&request.request_id, assistant_question(), |text| {
                    recorded.lock().unwrap().push(text.to_owned());
                    if let Some(arrived) = arrived.take() {
                        arrived.send(()).unwrap();
                    }
                })
                .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), partial)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(*progress.lock().unwrap(), ["第一段"]);
        assert!(
            !turn.is_finished(),
            "text must arrive while the HTTP body is still open"
        );
        if action == "cancel" {
            service.cancel_assistant("stream");
        }
        if action == "deadline" {
            tokio::time::pause();
            tokio::time::advance(std::time::Duration::from_secs(31)).await;
            tokio::task::yield_now().await;
            tokio::time::resume();
        }
        release.send(()).unwrap();
        let outcome = turn.await.unwrap();
        server.await.unwrap();
        match action {
            "complete" => assert_eq!(outcome.unwrap().text.as_deref(), Some("第一段 second")),
            "truncated" => assert!(matches!(outcome, Err(ModelServiceError::Protocol))),
            "cancel" => assert!(matches!(outcome, Err(ModelServiceError::Cancelled))),
            "deadline" => assert!(matches!(outcome, Err(ModelServiceError::Timeout))),
            _ => unreachable!(),
        }
        if action != "complete" {
            assert_eq!(*progress.lock().unwrap(), ["第一段"]);
        }
    }
}

#[tokio::test]
async fn assistant_budget_failure_ends_the_request_without_sending_an_http_request() {
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("secret").await.unwrap();
    let config = ModelServiceConfig {
        context: None,
        base_url: "http://127.0.0.1:1/v1".into(),
        model: "model".into(),
    };
    let request = service
        .begin_assistant(
            "project-a".into(),
            "request-a".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    let messages =
        serde_json::from_value(json!([{"role":"user","content":"x".repeat(128 * 1024 + 1)}]))
            .unwrap();
    assert!(matches!(
        service
            .assistant_turn(&request.request_id, messages, |_| {})
            .await,
        Err(ModelServiceError::ContextBytesExceeded)
    ));
    assert!(matches!(
        service
            .assistant_turn(&request.request_id, assistant_question(), |_| {})
            .await,
        Err(ModelServiceError::Cancelled)
    ));
}

#[tokio::test]
async fn assistant_cancel_config_and_identity_changes_abort_http_and_reject_late_turns() {
    for action in ["stop", "owner", "config", "save-key", "remove-key"] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = ModelServiceConfig {
            context: None,
            base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
            model: "model".into(),
        };
        let (received, accepted) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            let _ = socket.read(&mut bytes).await.unwrap();
            received.send(()).unwrap();
            let _ = released.await;
            let body = text_response().1;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        let service = Arc::new(ModelService::new(MemoryCredentials::default()));
        service.save_credential("old-secret").await.unwrap();
        let request = service
            .begin_assistant(
                "project-a".into(),
                "request-a".into(),
                config.clone(),
                service.assistant_revision(),
            )
            .await
            .unwrap();
        let sending = service.clone();
        let id = request.request_id.clone();
        let turn = tokio::spawn(async move {
            sending
                .assistant_turn(&id, assistant_question(), |_| {})
                .await
        });
        accepted.await.unwrap();
        assert!(matches!(
            service
                .assistant_turn(&request.request_id, assistant_question(), |_| {})
                .await,
            Err(ModelServiceError::RequestBusy)
        ));
        assert!(matches!(
            service
                .begin_assistant(
                    "project-b".into(),
                    "request-b".into(),
                    config,
                    service.assistant_revision()
                )
                .await,
            Err(ModelServiceError::RequestBusy)
        ));
        match action {
            "stop" => service.cancel_assistant(&request.request_id),
            "owner" => service.cancel_assistant_owner("project-a"),
            "config" => service.invalidate_assistant(),
            "save-key" => service.save_credential("new-secret").await.unwrap(),
            "remove-key" => service.remove_credential().await.unwrap(),
            _ => unreachable!(),
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), turn)
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(result, Err(ModelServiceError::Cancelled)),
            "action: {action}"
        );
        assert!(matches!(
            service
                .assistant_turn(&request.request_id, assistant_question(), |_| {})
                .await,
            Err(ModelServiceError::Cancelled)
        ));
        let _ = release.send(());
        server.await.unwrap();
    }
}

#[derive(Clone)]
struct BlockingReadCredentials {
    entered: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    release: Arc<Mutex<std::sync::mpsc::Receiver<()>>>,
}
impl CredentialStore for BlockingReadCredentials {
    fn contains(&self) -> Result<bool, ModelServiceError> {
        Ok(true)
    }
    fn read(&self) -> Result<Option<String>, ModelServiceError> {
        if let Some(entered) = self.entered.lock().unwrap().take() {
            let _ = entered.send(());
        }
        self.release.lock().unwrap().recv().unwrap();
        Ok(Some("private-secret".into()))
    }
    fn save(&self, _key: &str) -> Result<(), ModelServiceError> {
        Ok(())
    }
    fn remove(&self) -> Result<(), ModelServiceError> {
        Ok(())
    }
}

#[tokio::test]
async fn assistant_known_id_cancels_keychain_wait_and_allows_a_fresh_request() {
    let (entered, started) = tokio::sync::oneshot::channel();
    let (release, blocked) = std::sync::mpsc::channel();
    let service = Arc::new(ModelService::new(BlockingReadCredentials {
        entered: Arc::new(Mutex::new(Some(entered))),
        release: Arc::new(Mutex::new(blocked)),
    }));
    let opening = service.clone();
    let begin = tokio::spawn(async move {
        opening
            .begin_assistant(
                "project-a".into(),
                "request-a".into(),
                ModelServiceConfig {
                    context: None,
                    base_url: "http://127.0.0.1:1/v1".into(),
                    model: "model".into(),
                },
                opening.assistant_revision(),
            )
            .await
    });
    started.await.unwrap();
    service.cancel_assistant("request-a");
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), begin).await;
    let reopening = service.clone();
    let next = tokio::spawn(async move {
        reopening
            .begin_assistant(
                "project-a".into(),
                "request-b".into(),
                ModelServiceConfig {
                    context: None,
                    base_url: "http://127.0.0.1:1/v1".into(),
                    model: "model".into(),
                },
                reopening.assistant_revision(),
            )
            .await
    });
    // The old OS operation still owns the credential gate, but cancellation
    // must immediately release the request slot for a fresh attempt.
    let reserved = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while service.assistant_identity("request-b").is_err() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await;
    service.cancel_assistant("request-b");
    let next_result = tokio::time::timeout(std::time::Duration::from_secs(2), next).await;
    release.send(()).unwrap();
    assert!(reserved.is_ok());
    assert!(matches!(
        result.unwrap().unwrap(),
        Err(ModelServiceError::Cancelled)
    ));
    assert!(matches!(
        next_result.unwrap().unwrap(),
        Err(ModelServiceError::Cancelled)
    ));
}

#[tokio::test]
async fn assistant_old_request_ids_and_configuration_revisions_cannot_retarget_a_new_session() {
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("secret").await.unwrap();
    let (config, server) = http_stub(vec![text_response()]).await;
    let old_revision = service.assistant_revision();
    let first = service
        .begin_assistant("a".into(), "request-a".into(), config.clone(), old_revision)
        .await
        .unwrap();
    service.invalidate_assistant();
    assert!(matches!(
        service
            .begin_assistant("a".into(), "request-a".into(), config.clone(), old_revision)
            .await,
        Err(ModelServiceError::Cancelled)
    ));
    let second = service
        .begin_assistant(
            "b".into(),
            "request-b".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    assert_ne!(first.request_id, second.request_id);
    service.cancel_assistant(&first.request_id);
    service.cancel_assistant_owner("a");
    assert_eq!(service.assistant_identity(&second.request_id).unwrap(), "b");
    service
        .assistant_turn(&second.request_id, assistant_question(), |_| {})
        .await
        .unwrap();
    assert_eq!(server.await.unwrap().len(), 1);
}

#[tokio::test]
async fn assistant_cancel_before_begin_and_reused_ids_cannot_start_a_request() {
    let credentials = MemoryCredentials::default();
    let service = ModelService::new(credentials.clone());
    let config = ModelServiceConfig {
        context: None,
        base_url: "http://127.0.0.1:1/v1".into(),
        model: "model".into(),
    };
    service.cancel_assistant("cancelled-before-begin");
    assert!(matches!(
        service
            .begin_assistant(
                "project-a".into(),
                "cancelled-before-begin".into(),
                config.clone(),
                service.assistant_revision()
            )
            .await,
        Err(ModelServiceError::Cancelled)
    ));
    service.save_credential("secret").await.unwrap();
    let request = service
        .begin_assistant(
            "project-a".into(),
            "fresh-request".into(),
            config.clone(),
            service.assistant_revision(),
        )
        .await
        .unwrap();
    assert_eq!(request.request_id, "fresh-request");
    service.cancel_assistant(&request.request_id);
    assert!(matches!(
        service
            .begin_assistant(
                "project-b".into(),
                request.request_id,
                config.clone(),
                service.assistant_revision()
            )
            .await,
        Err(ModelServiceError::Cancelled)
    ));
    assert!(matches!(
        service
            .begin_assistant(
                "project-a".into(),
                "bad request id".into(),
                config,
                service.assistant_revision()
            )
            .await,
        Err(ModelServiceError::Protocol)
    ));
}

#[tokio::test]
async fn assistant_turn_budget_and_protocol_failures_end_the_session_without_retry() {
    let service = ModelService::new(MemoryCredentials::default());
    service.save_credential("secret").await.unwrap();
    let (config, server) = http_stub(vec![text_response(); 12]).await;
    let request = service
        .begin_assistant(
            "project-a".into(),
            "bounded".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    for _ in 0..12 {
        service
            .assistant_turn(&request.request_id, assistant_question(), |_| {})
            .await
            .unwrap();
    }
    assert!(matches!(
        service
            .assistant_turn(&request.request_id, assistant_question(), |_| {})
            .await,
        Err(ModelServiceError::BudgetExceeded)
    ));
    assert!(matches!(
        service.assistant_identity(&request.request_id),
        Err(ModelServiceError::Cancelled)
    ));
    assert_eq!(server.await.unwrap().len(), 12);

    let (config, server) = http_stub(vec![(
        200,
        json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":null}}]})
            .to_string(),
    )])
    .await;
    let request = service
        .begin_assistant(
            "project-a".into(),
            "malformed".into(),
            config,
            service.assistant_revision(),
        )
        .await
        .unwrap();
    assert!(matches!(
        service
            .assistant_turn(&request.request_id, assistant_question(), |_| {})
            .await,
        Err(ModelServiceError::Protocol)
    ));
    assert!(matches!(
        service.assistant_identity(&request.request_id),
        Err(ModelServiceError::Cancelled)
    ));
    assert_eq!(server.await.unwrap().len(), 1);
}

#[test]
fn assistant_owner_requires_the_live_native_folder_capability() {
    use crate::project::creation::{CreationAccess, Protection};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("score");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("server.js"), "// draft").unwrap();
    std::fs::write(root.join("manifest.json"), r#"{
        "schemaVersion":1,"id":"draft","name":"Draft","version":"0.1.0",
        "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},
        "audio":{"defaultMode":"none","supportedModes":["none"],"synthdefs":[],"scsynth":{"blockSize":64,"audioBusChannels":128}}
    }"#).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let first = access.open(&root, &protection).unwrap();
    assert!(validate_assistant_owner(&access, &first.project.identity, &protection).is_ok());
    assert_eq!(
        validate_assistant_owner(&access, "unissued", &protection),
        Err(ModelServiceError::InvalidIdentity)
    );
    let second = access.open(&root, &protection).unwrap();
    assert_eq!(
        validate_assistant_owner(&access, &first.project.identity, &protection),
        Err(ModelServiceError::InvalidIdentity)
    );
    access.close(&second.project.identity);
    assert_eq!(
        validate_assistant_owner(&access, &second.project.identity, &protection),
        Err(ModelServiceError::InvalidIdentity)
    );
    for protection in [
        Protection {
            bundles: vec![root.clone()],
            utilities: vec![],
        },
        Protection {
            bundles: vec![],
            utilities: vec![root.clone()],
        },
    ] {
        let readonly = access.open(&root, &protection).unwrap();
        assert_eq!(
            validate_assistant_owner(&access, &readonly.project.identity, &protection),
            Err(ModelServiceError::InvalidIdentity)
        );
    }
}
