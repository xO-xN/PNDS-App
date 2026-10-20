use super::*;
use tokio::io::AsyncWriteExt;

#[tokio::test]
async fn default_deepseek_edit_can_finish_a_tool_call_after_long_reasoning() {
    use crate::model::{chat, context, stream};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let client = client(None).unwrap();
    let endpoint = format!("http://{address}/chat/completions");
    let config = ModelServiceConfig {
        base_url: "https://api.deepseek.com".into(),
        model: "deepseek-flash".into(),
        context: None,
    };
    let messages = serde_json::from_value(json!([
        {"role":"system","content":"Complete the missing local page and scripts.","contextKind":"editPolicy"},
        {"role":"user","content":"Make Grid, Pattern and the monitor work."}
    ]))
    .unwrap();
    let (body, _) = context::assemble(&config, messages).unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let (_, body) = crate::model::tests::read_http_request(&mut socket).await;
        // Model the captured failure: reasoning and the following code call
        // share max_tokens. A complete response needs more than the App's old
        // implicit 4096 limit; an omitted limit uses the provider default.
        let truncated = body["max_tokens"]
            .as_u64()
            .is_some_and(|limit| limit < 6000);
        let delta = if truncated {
            json!({"reasoning_content":"fixture reasoning","tool_calls":[{"index":0,"id":"page","type":"function","function":{"name":"create_project_file","arguments":"{\"path\":\"public/monitor.html\","}}]})
        } else {
            json!({"reasoning_content":"fixture reasoning","tool_calls":[{"index":0,"id":"page","type":"function","function":{"name":"create_project_file","arguments":"{\"path\":\"public/monitor.html\",\"text\":\"<!doctype html>\"}"}}]})
        };
        let finish = if truncated { "length" } else { "tool_calls" };
        let reply = format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"index":0,"delta":delta,"finish_reason":null}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":finish}]})
        );
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len()).as_bytes()).await.unwrap();
    });
    let result = stream::request(&client, &endpoint, "fixture-key", body, |_| {}).await;
    server.await.unwrap();
    let turn =
        chat::parse_turn(result.expect("default DeepSeek edit must finish its code tool call"))
            .unwrap();
    assert_eq!(turn.tool_calls.len(), 1);
    assert_eq!(turn.tool_calls[0].name, "create_project_file");
    assert_eq!(
        serde_json::from_str::<Value>(&turn.tool_calls[0].arguments).unwrap()["path"],
        "public/monitor.html"
    );
}

#[tokio::test]
async fn deepseek_json_and_sse_replay_reasoning_across_multiple_tool_rounds() {
    use crate::model::{chat, context, stream, AssistantModelMessage, ModelContextConfig};
    for streaming in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let _ = client(None).unwrap();
        let client = Client::builder()
            .no_proxy()
            .resolve("api.deepseek.com", address)
            .build()
            .unwrap();
        let endpoint = format!(
            "http://api.deepseek.com:{}/chat/completions",
            address.port()
        );
        let server = tokio::spawn(async move {
            for step in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let (_, body) = crate::model::tests::read_http_request(&mut socket).await;
                assert_eq!(body["thinking"]["type"], "enabled");
                assert_eq!(body["tool_choice"], "auto");
                assert_eq!(body["max_tokens"], 4160);
                assert!(body.get("max_completion_tokens").is_none());
                let assistants = body["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|message| message["role"] == "assistant")
                    .collect::<Vec<_>>();
                assert_eq!(assistants.len(), step);
                if step > 0 {
                    assert_eq!(assistants[0]["reasoning_content"], "private thought 1");
                }
                if step > 1 {
                    assert_eq!(assistants[1]["reasoning_content"], "");
                }
                let reasoning = if step == 1 { "" } else { "private thought 1" };
                let calls = if step < 2 {
                    json!([{"id":format!("search-{step}"),"type":"function","function":{"name":"search_help","arguments":"{}"}}])
                } else {
                    json!([])
                };
                let text = if step < 2 { "Checking." } else { "Finished." };
                let finish = if step < 2 { "tool_calls" } else { "stop" };
                let (mime, reply) = if streaming {
                    let calls = calls
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|call| {
                            let mut call = call.clone();
                            call["index"] = json!(0);
                            call
                        })
                        .collect::<Vec<_>>();
                    let frame = |delta: Value, finish: Value| {
                        format!(
                            "data: {}\n\n",
                            json!({"choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
                        )
                    };
                    (
                        "text/event-stream",
                        format!(
                            "{}{}{}data: [DONE]\n\n",
                            frame(
                                json!({"role":"assistant","reasoning_content":reasoning}),
                                Value::Null
                            ),
                            frame(json!({"content":text,"tool_calls":calls}), Value::Null),
                            frame(json!({}), json!(finish))
                        ),
                    )
                } else {
                    ("application/json", json!({"choices":[{"finish_reason":finish,"message":{"role":"assistant","content":text,"reasoning_content":reasoning,"tool_calls":calls}}]}).to_string())
                };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len()).as_bytes()).await.unwrap();
            }
        });
        let config = ModelServiceConfig {
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-flash".into(),
            context: Some(ModelContextConfig {
                max_output: Some(4096),
                reasoning_reserve: 64,
                ..ModelContextConfig::default()
            }),
        };
        let mut messages: Vec<AssistantModelMessage> =
            serde_json::from_value(json!([{"role":"user","content":"Read the guide."}])).unwrap();
        let mut progress = Vec::new();
        for step in 0..3 {
            let (body, measurement) = context::assemble(&config, messages.clone()).unwrap();
            assert!(measurement.exceeded.is_none());
            let message = stream::request(&client, &endpoint, "fixture-key", body, |text| {
                progress.push(text.to_owned())
            })
            .await
            .unwrap();
            let turn = chat::parse_turn(message).unwrap();
            assert_eq!(
                turn.reasoning_content.as_deref(),
                Some(if step == 1 { "" } else { "private thought 1" })
            );
            if step < 2 {
                messages.push(serde_json::from_value(json!({"role":"assistant","content":turn.text,"reasoningContent":turn.reasoning_content,"toolCalls":turn.tool_calls})).unwrap());
                messages.push(serde_json::from_value(json!({"role":"tool","content":"found","toolCallId":format!("search-{step}")})).unwrap());
            } else {
                assert_eq!(turn.text.as_deref(), Some("Finished."));
            }
        }
        server.await.unwrap();
        assert_eq!(progress, ["Checking.", "Checking.", "Finished."]);
    }
}

#[tokio::test]
async fn deepseek_probe_completes_without_forcing_a_tool_in_default_thinking_mode() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    // DNS is isolated to this loopback fixture; no paid provider is contacted.
    let _ = client(None).unwrap();
    let client = Client::builder()
        .no_proxy()
        .resolve("api.deepseek.com", address)
        .build()
        .unwrap();
    let endpoint = format!(
        "http://api.deepseek.com:{}/chat/completions",
        address.port()
    );
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for step in 0..3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let (_, body) = crate::model::tests::read_http_request(&mut socket).await;
            let invalid = body["thinking"]["type"] != "disabled" && body["tool_choice"].is_object();
            let (status, reply) = if invalid {
                (
                    400,
                    json!({"error":{"type":"invalid_request_error","param":"tool_choice"}}),
                )
            } else if step == 1 {
                (
                    200,
                    json!({"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"probe","type":"function","function":{"name":PROBE_NAME,"arguments":json!({"value":PROBE_VALUE}).to_string()}}]}}]}),
                )
            } else {
                (
                    200,
                    json!({"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"OK"}}]}),
                )
            };
            requests.push(body);
            let reply = reply.to_string();
            socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len()).as_bytes()).await.unwrap();
            if invalid {
                break;
            }
        }
        requests
    });
    let result = probe(&client, &endpoint, "deepseek-flash", "fixture-key").await;
    let requests = server.await.unwrap();
    assert!(result.is_ok(), "DeepSeek probe failed: {result:?}");
    assert_eq!(requests.len(), 3);
    for request in requests {
        assert_eq!(request["thinking"]["type"], "disabled");
        assert_eq!(request["max_tokens"], 128);
    }
}
