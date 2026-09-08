//! Locating the bundled sidecar binaries (Node.js score server, scsynth).
//!
//! Fetch scripts leave raw sidecars under `src-tauri/binaries` named
//! `<base>-<target-triple>` (Tauri's `externalBin` convention); the
//! packaged app strips the triple, so the same lookup must resolve for
//! whichever architecture the App itself was built for.

use std::path::{Path, PathBuf};

/// The cargo target triple this App binary was built for (forwarded from
/// the build script's `TARGET`; the build host's architecture is
/// irrelevant when cross-compiling).
pub fn target_triple() -> &'static str {
    env!("PNDS_TARGET_TRIPLE")
}

/// Resolves a bundled sidecar for THIS build: `packaged_relative_to_exe`
/// (e.g. `node`, `../Resources/scsynth`) next to the running executable,
/// else the fetch scripts' `src-tauri/binaries/<base>-<triple>`.
pub(crate) fn resolve(base: &str, packaged_relative_to_exe: &str) -> Option<PathBuf> {
    let packaged = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(packaged_relative_to_exe)));
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    locate_sidecar(packaged.as_deref(), &dev, base, target_triple())
}

/// Finds a bundled sidecar binary. The packaged candidate (architecture-
/// neutral name — the bundler strips the triple) wins; the development
/// fallback is `binaries/<base>-<triple>` for the App's OWN triple, so a
/// binary fetched for another architecture is never picked up by mistake.
pub(crate) fn locate_sidecar(
    packaged: Option<&Path>,
    dev_binaries_dir: &Path,
    base: &str,
    triple: &str,
) -> Option<PathBuf> {
    if let Some(path) = packaged.filter(|path| path.is_file()) {
        return Some(path.to_path_buf());
    }
    let dev = dev_binaries_dir.join(format!("{base}-{triple}"));
    dev.is_file().then_some(dev)
}

#[cfg(test)]
mod tests {
    use super::{locate_sidecar, target_triple};
    use std::fs;
    use std::path::PathBuf;

    fn binaries_dir_with(names: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let binaries = dir.path().join("binaries");
        fs::create_dir_all(&binaries).unwrap();
        for name in names {
            fs::write(binaries.join(name), b"").unwrap();
        }
        (dir, binaries)
    }

    #[test]
    fn target_triple_matches_the_running_architectures_mac_triple() {
        // Cross-check two independent sources: the cargo TARGET forwarded
        // by the build script vs. the running test binary's own consts.
        #[cfg(target_os = "macos")]
        assert_eq!(
            target_triple(),
            format!("{}-apple-darwin", std::env::consts::ARCH)
        );
        assert!(!target_triple().contains(char::is_whitespace));
    }

    #[test]
    fn dev_fallback_resolves_the_binary_named_for_the_requested_triple() {
        let (_dir, binaries) =
            binaries_dir_with(&["node-x86_64-apple-darwin", "node-aarch64-apple-darwin"]);

        assert_eq!(
            locate_sidecar(None, &binaries, "node", "x86_64-apple-darwin"),
            Some(binaries.join("node-x86_64-apple-darwin"))
        );
        assert_eq!(
            locate_sidecar(None, &binaries, "node", "aarch64-apple-darwin"),
            Some(binaries.join("node-aarch64-apple-darwin"))
        );
    }

    #[test]
    fn dev_fallback_never_substitutes_a_binary_fetched_for_another_architecture() {
        let (_dir, binaries) = binaries_dir_with(&["scsynth-aarch64-apple-darwin"]);

        assert_eq!(
            locate_sidecar(None, &binaries, "scsynth", "x86_64-apple-darwin"),
            None
        );
    }

    #[test]
    fn packaged_binary_wins_over_the_dev_fallback() {
        let (dir, binaries) = binaries_dir_with(&["scsynth-aarch64-apple-darwin"]);
        // The bundler strips the triple: Contents/Resources/scsynth.
        let packaged = dir.path().join("Contents/Resources/scsynth");
        fs::create_dir_all(packaged.parent().unwrap()).unwrap();
        fs::write(&packaged, b"").unwrap();

        assert_eq!(
            locate_sidecar(
                Some(&packaged),
                &binaries,
                "scsynth",
                "aarch64-apple-darwin"
            ),
            Some(packaged.clone())
        );
    }

    #[test]
    fn a_packaged_path_that_is_not_a_file_falls_back_to_dev() {
        let (dir, binaries) = binaries_dir_with(&["node-x86_64-apple-darwin"]);
        let missing = dir.path().join("Contents/MacOS/node");

        assert_eq!(
            locate_sidecar(Some(&missing), &binaries, "node", "x86_64-apple-darwin"),
            Some(binaries.join("node-x86_64-apple-darwin"))
        );
    }
}
