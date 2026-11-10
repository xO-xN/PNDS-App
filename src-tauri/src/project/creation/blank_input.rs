//! Public creation/editor -> delivered project -> accepted real input and effects.
use super::*;
use std::process::Command;

#[test]
fn blank_public_input_reaches_real_work_state_after_identity_validation() {
    let temp = tempfile::tempdir().unwrap();
    let protection = Protection::default();
    let mut access = CreationAccess::default();
    let prepared = access
        .create_blank(
            &NewProjectOptions {
                parent: temp.path().display().to_string(),
                folder_name: "contact-score".into(),
                name: "Contacts".into(),
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
    let CreationContent::Text { text, version, .. } = access
        .read(&identity, "public/monitor.js", &protection)
        .unwrap()
    else {
        panic!("monitor source")
    };
    access.save(&identity, "public/monitor.js", &format!("{text}\nsocket.on('pnds:performance', state => {{ document.body.dataset.contacts = String(state.performers.reduce((sum, player) => sum + player.contacts.length, 0)) }})\n"), &version, &protection).unwrap();
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
    let script = temp.path().join("input.mjs");
    fs::write(
        temp.path().join("input-browser.mjs"),
        include_str!("blank_input_browser.mjs"),
    )
    .unwrap();
    fs::write(
        temp.path().join("native-touch.js"),
        include_str!("../../../../src/lib/performer-touch-script.js"),
    )
    .unwrap();
    fs::write(&script, include_str!("blank_input.mjs")).unwrap();
    let mut ports = crate::test_support::FixturePorts::<2>::reserve("Blank public input").unwrap();
    let values = serde_json::to_string(&ports.values()).unwrap();
    ports.release_for_start();
    let output = Command::new(crate::project::session::node_binary_path().unwrap())
        .arg(script)
        .arg(root)
        .arg(client.path)
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("node_modules/jsdom/lib/api.js"),
        )
        .env_clear()
        .env("PNDS_FIXTURE_PORTS", values)
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
}
