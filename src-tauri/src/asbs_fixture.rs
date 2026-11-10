//! Only explicit ASBS acceptance fixtures load the separately maintained source.
use std::path::{Path, PathBuf};

fn copy(source: &Path, destination: &Path) {
    if source.is_dir() {
        std::fs::create_dir_all(destination).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            copy(&entry.path(), &destination.join(entry.file_name()));
        }
    } else {
        std::fs::copy(source, destination).unwrap();
    }
}
pub(super) fn project(parent: &Path) -> PathBuf {
    let source = PathBuf::from(
        std::env::var_os("PNDS_ASBS_SOURCE")
            .expect("PNDS_ASBS_SOURCE must name the maintained, built ASBS 2.1.1 source"),
    );
    let root = parent.join("actual-asbs");
    std::fs::create_dir_all(&root).unwrap();
    for name in [
        "server.js",
        "lib",
        "shared",
        "public",
        "dist",
        "package.json",
        "manifest.json",
    ] {
        copy(&source.join(name), &root.join(name));
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["id"], "all-sentient-being-sounds");
    assert_eq!(manifest["scoreServer"]["browserParticipation"], 1);
    let page = root.join("dist/src/performer/index.html");
    let html = std::fs::read_to_string(&page)
        .unwrap()
        .replace("<head>", "<head><script src='./asbs-proof.js'></script>");
    std::fs::write(page, html).unwrap();
    std::fs::write(
        root.join("dist/asbs-proof.js"),
        include_str!("asbs-clock-fixture.js"),
    )
    .unwrap();
    root
}
pub(super) fn hide_middle(root: &Path) {
    let file = root.join("public/libraries/A1/A1P15.png");
    std::fs::rename(&file, file.with_extension("held")).unwrap();
}
pub(super) fn restore_middle(root: &Path) {
    let file = root.join("public/libraries/A1/A1P15.png");
    std::fs::rename(file.with_extension("held"), file).unwrap();
}
