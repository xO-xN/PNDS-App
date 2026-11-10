//! Public creation -> delivered project -> real Socket.IO identity and restart.
use super::*;
use std::process::Command;

#[test]
fn blank_players_recover_after_a_new_server_process_and_isolate_observers() {
    let temp = tempfile::tempdir().unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let prepared = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "persistent-players".into(),
                name: "Players".into(),
                author: String::new(),
                description: String::new(),
                locale: "en".into(),
                git_name: None,
                git_email: None,
            },
            &tests::shared_libraries(),
            &protection,
        )
        .unwrap();
    let root = Path::new(&prepared.project.root);
    let identity = access.open(root, &protection).unwrap().project.identity;
    let CreationContent::Text { text, version, .. } =
        access.read(&identity, "server.js", &protection).unwrap()
    else {
        panic!("server source")
    };
    let edited = text
        .replace("const playerPolicy =", "const identityProbe = new Map()\nconst playerPolicy =")
        .replace("// Apply accepted performer controls here. Identity ownership is already checked.", "if (Number.isFinite(payload?.value)) identityProbe.set(context.identity.id, { value: payload.value })")
        .replace("// Apply accepted performer actions here. Identity ownership is already checked.", "if (Number.isFinite(payload?.action)) identityProbe.set(context.identity.id, { value: payload.action })")
        .replace("// Release this performer's live work resources here; never release another owner.", "identityProbe.delete(context.identity.id)")
        .replace("// Return actual per-run work state here, separate from persistent identities.\n    return {}", "return { identityProbe: Object.fromEntries(identityProbe) }");
    assert_ne!(text, edited);
    access
        .save(&identity, "server.js", &edited, &version, &protection)
        .unwrap();
    let manifest = crate::project::manifest::load_manifest(root).unwrap();
    let shared = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &manifest.shared_libraries,
    )
    .unwrap();
    let client = crate::project::shared_libraries::resolve_at(
        &tests::shared_libraries(),
        &[crate::project::manifest::SharedLibraryReference {
            id: "socket.io-client".into(),
            version: "4.8.4".into(),
        }],
    )
    .unwrap()
    .remove("socket.io-client")
    .unwrap();
    let script = temp.path().join("players.mjs");
    fs::write(&script, include_str!("blank_players.mjs")).unwrap();
    let mut ports = crate::test_support::FixturePorts::<2>::reserve("Blank players").unwrap();
    let port_values = serde_json::to_string(&ports.values()).unwrap();
    ports.release_for_start();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(script)
        .arg(root)
        .arg(client.path)
        .env_clear()
        .env("PNDS_FIXTURE_PORTS", port_values)
        .env(
            "PNDS_SHARED_LIBRARIES",
            serde_json::to_string(&shared).unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(root.join(".pnds-creation/players.json").is_file());
    let destination = temp.path().join("distribution.pnds");
    crate::project::bundle::pack_project_at_with_libraries(
        root,
        Some(&destination),
        false,
        env!("CARGO_PKG_VERSION"),
        Some(&tests::shared_libraries()),
    )
    .unwrap();
    let archive = zip::ZipArchive::new(File::open(destination).unwrap()).unwrap();
    assert!(!archive
        .file_names()
        .any(|name| name.contains(".pnds-creation")));
}
