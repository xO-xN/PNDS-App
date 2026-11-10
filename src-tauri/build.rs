fn main() {
    // Native permission prompts follow the OS language. Keep their bundled
    // resources synchronized with the same locale catalog as the App UI.
    for (language, folder) in [("en", "en"), ("zh-CN", "zh-Hans")] {
        let catalog_path = format!("../locales/{language}.json");
        println!("cargo:rerun-if-changed={catalog_path}");
        let catalog: serde_json::Value = serde_json::from_slice(
            &std::fs::read(catalog_path).expect("native permission locale catalog"),
        )
        .expect("valid locale catalog");
        let mut expected = String::new();
        for (native, key) in [
            ("NSCameraUsageDescription", "native.cameraUsage"),
            ("NSMicrophoneUsageDescription", "native.microphoneUsage"),
            ("NSLocalNetworkUsageDescription", "native.localNetworkUsage"),
        ] {
            let copy = catalog[key].as_str().expect("native permission copy");
            let quoted = serde_json::to_string(copy).expect("quoted native copy");
            expected.push_str(&format!("\"{native}\" = {quoted};\n"));
        }
        let resource = format!("resources/native-locales/{folder}.lproj/InfoPlist.strings");
        println!("cargo:rerun-if-changed={resource}");
        assert_eq!(
            std::fs::read_to_string(resource).expect("native locale resource"),
            expected,
            "Native permission resources must match locales/{language}.json"
        );
    }

    // Ordinary compilation needs no sclang. A source/artifact pair is refreshed
    // only by the real compiler; release provisioning also recompiles and compares it.
    use sha2::{Digest, Sha256};
    let root = std::path::Path::new("resources/blank-project");
    let proof = root.join("synthdef.sha256");
    println!("cargo:rerun-if-changed={}", proof.display());
    let proof = std::fs::read_to_string(proof).expect("blank SynthDef compiler proof");
    for path in [
        "supercollider/source/pndsBlank.scd",
        "supercollider/synthdefs/pndsBlank.scsyndef",
    ] {
        let file = root.join(path);
        println!("cargo:rerun-if-changed={}", file.display());
        let bytes = std::fs::read(file).expect("blank SynthDef asset");
        let actual = format!("{:x}", Sha256::digest(bytes));
        let expected = proof
            .lines()
            .find_map(|line| {
                line.split_once("  ")
                    .filter(|(_, name)| *name == path)
                    .map(|(hash, _)| hash)
            })
            .expect("source and artifact proof entries");
        assert_eq!(actual, expected, "Blank SynthDef source/artifact changed; run bash scripts/check-blank-synthdef.sh --write with sclang, then verify --check");
    }
    // The creation input is a fixed verified candidate snapshot. Changing any
    // included source requires an intentional new provenance record.
    let classic = std::path::Path::new("resources/classic-project");
    let inventory = classic.join("source.sha256");
    println!("cargo:rerun-if-changed={}", inventory.display());
    let proof = std::fs::read_to_string(inventory).expect("Classic source inventory");
    assert_eq!(
        format!("{:x}", Sha256::digest(proof.as_bytes())),
        "98ad0e4b0d3803958bc02f3d786ba0c177bfbcde093cdec3f699bb622f44b766",
        "Classic inventory must match the verified provenance snapshot"
    );
    for line in proof.lines() {
        let (expected, path) = line.split_once("  ").expect("Classic inventory record");
        let file = classic.join("source").join(path);
        println!("cargo:rerun-if-changed={}", file.display());
        let actual = format!(
            "{:x}",
            Sha256::digest(std::fs::read(file).expect("Classic source asset"))
        );
        assert_eq!(
            actual, expected,
            "Classic source changed without verified source pinning: {path}"
        );
    }
    // Exact cargo target triple (e.g. x86_64-apple-darwin) for sidecar
    // file naming — what `tauri build --target` and the fetch scripts
    // use, NOT the arch of the machine running the build.
    let target = std::env::var("TARGET").expect("cargo always sets TARGET for build scripts");
    println!("cargo:rustc-env=PNDS_TARGET_TRIPLE={target}");
    tauri_build::build()
}
