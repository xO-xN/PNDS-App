fn main() {
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
        "e5db14f6b2be7556ae0fdc261cb8c694b1641841e0a22c96b86e158797811dd5",
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
