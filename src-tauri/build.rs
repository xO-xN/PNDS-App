fn main() {
    // Exact cargo target triple (e.g. x86_64-apple-darwin) for sidecar
    // file naming — what `tauri build --target` and the fetch scripts
    // use, NOT the arch of the machine running the build.
    let target = std::env::var("TARGET").expect("cargo always sets TARGET for build scripts");
    println!("cargo:rustc-env=PNDS_TARGET_TRIPLE={target}");
    tauri_build::build()
}
