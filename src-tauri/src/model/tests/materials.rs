use super::*;
use crate::project::creation::{CreationAccess, CreationMaterialRead, Protection};

/// The frontend replay covers orchestration; this boundary proves the native
/// page from a real private copy survives transport as exactly the requested range.
#[tokio::test]
async fn imported_material_page_reaches_model_without_unrequested_private_text() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("score");
    let data = temp.path().join("app-data");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("server.js"), "// score").unwrap();
    std::fs::write(
        root.join("manifest.json"),
        r#"{
          "schemaVersion":1,"id":"material-wire","name":"Score","version":"0.1.0",
          "scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},
          "audio":{"defaultMode":"none","supportedModes":["none"]}
        }"#,
    )
    .unwrap();
    let original = temp.path().join("创作说明.txt");
    let requested = "A".repeat(64);
    std::fs::write(&original, format!("{requested}\nUNREQUESTED-SECOND-PAGE")).unwrap();
    let unrelated = temp.path().join("other.md");
    std::fs::write(&unrelated, "UNRELATED-PRIVATE-MATERIAL").unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let material = access
        .add_material(&data, &identity, &original, &protection)
        .unwrap();
    access
        .add_material(&data, &identity, &unrelated, &protection)
        .unwrap();
    // Later source-file changes cannot replace the App's received original.
    std::fs::write(&original, "CHANGED-EXTERNAL-ORIGINAL").unwrap();
    drop(access);
    let mut reopened = CreationAccess::default();
    let identity = reopened.open(&root, &protection).unwrap().project.identity;

    for policy in ["handoffPolicy", "editPolicy"] {
        let read = json!({
            "id":material.id,"version":material.version,"offset":0,"pageLength":64
        });
        let mut response: Value = serde_json::from_str(&tool_response().1).unwrap();
        response["choices"][0]["message"]["tool_calls"][0]["function"] =
            json!({"name":"read_creation_material","arguments":read.to_string()});
        let (config, server) = http_stub(vec![(200, response.to_string()), text_response()]).await;
        let service = ModelService::new(MemoryCredentials::default());
        service.save_credential("test-material-key").await.unwrap();
        let session = service
            .begin_assistant(
                identity.clone(),
                format!("material-{policy}"),
                config,
                service.assistant_revision(),
            )
            .await
            .unwrap();
        let mut messages: Vec<AssistantModelMessage> = serde_json::from_value(json!([
            {"role":"system","content":"Read reference data within the current task.","contextKind":policy},
            {"role":"user","content":"Read the first page of the selected reference."}
        ]))
        .unwrap();
        let first = service
            .assistant_turn(&session.request_id, messages.clone(), |_| {})
            .await
            .unwrap();
        let call = &first.tool_calls[0];
        assert_eq!(call.name, "read_creation_material");
        let read: CreationMaterialRead = serde_json::from_str(&call.arguments).unwrap();
        let page = reopened
            .read_material(&data, &identity, &read, &protection)
            .unwrap();
        assert_eq!(page.text, requested);
        assert_eq!(page.offset, 0);
        assert_eq!(page.end_offset, 64);
        assert_eq!(page.next_offset, Some(64));
        messages.push(
            serde_json::from_value(json!({
                "role":"assistant","content":null,"toolCalls":first.tool_calls
            }))
            .unwrap(),
        );
        messages.push(
            serde_json::from_value(json!({
                "role":"tool","toolCallId":"call-probe",
                "content":serde_json::to_string(&page).unwrap(),"contextKind":"projectFragment"
            }))
            .unwrap(),
        );
        service
            .assistant_turn(&session.request_id, messages, |_| {})
            .await
            .unwrap();
        let packets = server.await.unwrap();
        assert_eq!(packets.len(), 2);
        assert!(!packets[0].1.to_string().contains(&requested));
        let sent: Value =
            serde_json::from_str(packets[1].1["messages"][3]["content"].as_str().unwrap()).unwrap();
        assert_eq!(sent, serde_json::to_value(page).unwrap());
        for (_, packet) in packets {
            let names: Vec<_> = packet["tools"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|tool| tool["function"]["name"].as_str())
                .collect();
            assert!(names.contains(&"list_creation_materials"));
            assert!(names.contains(&"read_creation_material"));
            let payload = packet.to_string();
            for excluded in [
                "UNREQUESTED-SECOND-PAGE",
                "UNRELATED-PRIVATE-MATERIAL",
                "CHANGED-EXTERNAL-ORIGINAL",
                temp.path().to_str().unwrap(),
            ] {
                assert!(!payload.contains(excluded));
            }
        }
    }
}
