use super::*;
use crate::project::creation::tests::project;
use serde_json::json;

#[test]
fn preview_authorization_requires_ready_same_root_and_current_saved_sources() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "authorization");
    fs::write(
        root.join("pnds.preview.json"),
        r#"{"schemaVersion":1,"parameters":[]}"#,
    )
    .unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let descriptor = access.open(&root, &protection).unwrap().project;
    let identity = &descriptor.identity;
    let CreationContent::Text { text, version } =
        access.read(identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let (_, contract_version) = access
        .parameter_contract(identity, &protection)
        .unwrap()
        .unwrap();
    let mut runtime = crate::project::session::SessionManager::default().creation_runtime();
    assert!(access
        .authorize_parameter_preview(
            identity,
            "server.js",
            &version,
            &contract_version,
            runtime.clone(),
            &protection
        )
        .is_err());
    runtime.snapshot.status = crate::types::SessionStatus::Ready;
    runtime.project_root = Some("/wrong-root".into());
    assert!(access
        .authorize_parameter_preview(
            identity,
            "server.js",
            &version,
            &contract_version,
            runtime.clone(),
            &protection
        )
        .is_err());
    runtime.project_root = Some(descriptor.root);
    let result = access
        .authorize_parameter_preview(
            identity,
            "server.js",
            &version,
            &contract_version,
            runtime.clone(),
            &protection,
        )
        .unwrap();
    assert_eq!(result.source_digest, preview_digest(&text));
    assert!(access
        .authorize_parameter_preview(
            identity,
            "server.js",
            &version,
            "stale-contract",
            runtime.clone(),
            &protection
        )
        .is_err());
    fs::write(root.join("server.js"), "external source").unwrap();
    assert!(access
        .authorize_parameter_preview(
            identity,
            "server.js",
            &version,
            &contract_version,
            runtime.clone(),
            &protection
        )
        .is_err());
    assert!(access
        .authorize_parameter_preview(
            "other",
            "server.js",
            &version,
            &contract_version,
            runtime,
            &protection
        )
        .is_err());
}

#[test]
fn parameter_binding_checks_real_source_and_keeps_suggested_ranges_separate() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "parameters");
    fs::write(
        root.join("server.js"),
        "const speed = 2;\nconst title = \"Blue\";\n",
    )
    .unwrap();
    let spec = json!({"id":"speed","path":"server.js","prefix":"const speed = ","suffix":";","kind":"number","limits":{"min":0,"max":10},"preview":"live"});
    fs::write(
        root.join("pnds.preview.json"),
        json!({"schemaVersion":1,"parameters":[spec.clone()]}).to_string(),
    )
    .unwrap();
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("text")
    };
    let request: ParameterRequest =
        serde_json::from_value(json!({"spec":spec,"current":2,"suggestedMin":1,"suggestedMax":4}))
            .unwrap();
    let bound = access
        .bind_parameters(
            &identity,
            "server.js",
            &version,
            "const speed = 3;\nconst title = \"Blue\";\n",
            std::slice::from_ref(&request),
            &protection,
        )
        .unwrap();
    assert_eq!(bound.parameters[0].value, Some(json!(3)));
    assert!(!bound.partial);
    assert_eq!(bound.parameters[0].request.spec.limits.max, Some(10.0));
    let outside = access
        .bind_parameters(
            &identity,
            "server.js",
            &version,
            "const speed = 11;\nconst title = \"Blue\";\n",
            std::slice::from_ref(&request),
            &protection,
        )
        .unwrap();
    assert!(outside.parameters[0].value.is_none());
    let mut forged = request.clone();
    forged.spec.limits.max = Some(100.0);
    assert!(access
        .bind_parameters(
            &identity,
            "server.js",
            &version,
            "const speed = 3;\n",
            &[forged],
            &protection
        )
        .is_err());
    let mut decimal = request.clone();
    decimal.current = json!(2.0);
    assert!(access
        .bind_parameters(
            &identity,
            "server.js",
            &version,
            "const speed = 3;\n",
            &[decimal],
            &protection
        )
        .is_ok());
    assert_eq!(
        fs::read_to_string(root.join("server.js")).unwrap(),
        "const speed = 2;\nconst title = \"Blue\";\n"
    );
    assert!(access
        .bind_parameters(&identity, "server.js", "stale", "", &[request], &protection)
        .is_err());
}

#[test]
fn nonnumeric_nested_project_values_bind_without_an_adapter_but_expressions_do_not() {
    let temp = tempfile::tempdir().unwrap();
    let root = project(temp.path(), "nested");
    fs::create_dir(root.join("public")).unwrap();
    let source = "  title: \"Blue\",\n  enabled: true,\n  color: \"#112233\",\n";
    fs::write(root.join("public/config.js"), source).unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let identity = access.open(&root, &protection).unwrap().project.identity;
    let CreationContent::Text { version, .. } = access
        .read(&identity, "public/config.js", &protection)
        .unwrap()
    else {
        panic!("text")
    };
    let requests: Vec<ParameterRequest> = [
        ("title","text",json!("Blue")),("enabled","boolean",json!(true)),("color","color",json!("#112233"))
    ].into_iter().map(|(id,kind,current)| serde_json::from_value(json!({"spec":{"id":id,"path":"public/config.js","prefix":format!("  {id}: "),"suffix":",","kind":kind,"limits":{},"preview":"unsupported"},"current":current})).unwrap()).collect();
    let candidate =
        "  title: \"Amber\",\n  enabled: false,\n  color: \"#abcdef\",\n// handwritten\n";
    let bound = access
        .bind_parameters(
            &identity,
            "public/config.js",
            &version,
            candidate,
            &requests,
            &protection,
        )
        .unwrap();
    assert!(bound.partial);
    assert!(bound.contract_version.is_none());
    assert_eq!(bound.parameters[1].value, Some(json!(false)));
    let expression = candidate.replace("\"Amber\"", "name + suffix");
    let bound = access
        .bind_parameters(
            &identity,
            "public/config.js",
            &version,
            &expression,
            &requests,
            &protection,
        )
        .unwrap();
    assert!(bound.parameters[0].value.is_none());
    assert_eq!(
        fs::read_to_string(root.join("public/config.js")).unwrap(),
        source
    );
    let mut forged = requests.clone();
    forged[0].spec.preview = ParameterPreview::Live;
    assert!(access
        .bind_parameters(
            &identity,
            "public/config.js",
            &version,
            candidate,
            &forged,
            &protection
        )
        .is_err());
    forged[0] = requests[0].clone();
    forged[0].current = json!("wrong");
    assert!(access
        .bind_parameters(
            &identity,
            "public/config.js",
            &version,
            candidate,
            &forged,
            &protection
        )
        .is_err());
    assert!(access
        .bind_parameters(
            &identity,
            "../outside.js",
            &version,
            candidate,
            &requests,
            &protection
        )
        .is_err());
    fs::write(
        root.join("pnds.preview.json"),
        r#"{"schemaVersion":2,"parameters":[]}"#,
    )
    .unwrap();
    assert!(access
        .bind_parameters(
            &identity,
            "public/config.js",
            &version,
            candidate,
            &requests,
            &protection
        )
        .is_err());
}
