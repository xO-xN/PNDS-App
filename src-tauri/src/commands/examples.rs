//! Bundled example score projects (v1.1.2 T7, spec issue #11): the two
//! utility projects the app seeds into the default Utilities folder.
//!
//! A release bundle installs them under the resources directory (V1.2
//! bundling scope); development resolves them from the repository checkout
//! next to `src-tauri`, so the folder works in `tauri dev` today.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Directory names of the bundled examples, in Utilities order.
const EXAMPLE_NAMES: [&str; 2] = ["Local Network Diagnostics", "Multichannel Signal Generator"];

/// Roots that may hold the `examples/` tree, most specific first: the app
/// bundle's resources (release), then — in debug builds only — the
/// repository checkout that `tauri dev` runs from.
fn example_base_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources);
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    candidates
}

/// Example project directories under `base` that contain a manifest — a
/// missing entry is skipped rather than seeding a dead path.
fn resolve_from_base(base: &Path) -> Vec<PathBuf> {
    EXAMPLE_NAMES
        .iter()
        .map(|name| base.join("examples").join(name))
        .filter(|path| path.join("manifest.json").is_file())
        .collect()
}

/// v1.1.2 T7: absolute paths of the bundled example projects that make up
/// the Utilities folder. Empty when none are installed — the frontend then
/// seeds nothing.
#[tauri::command]
#[specta::specta]
pub async fn bundled_example_projects(app: AppHandle) -> Result<Vec<String>, String> {
    for base in example_base_candidates(&app) {
        let resolved = resolve_from_base(&base);
        if resolved.is_empty() {
            continue;
        }
        return Ok(resolved
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect());
    }
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A base resolves exactly the example directories that carry a
    /// manifest; entries without one are skipped, not seeded dead.
    #[test]
    fn resolves_only_manifest_carrying_examples() {
        let base = tempfile::tempdir().unwrap();
        let with_manifest = base.path().join("examples").join(EXAMPLE_NAMES[0]);
        let without_manifest = base.path().join("examples").join(EXAMPLE_NAMES[1]);
        std::fs::create_dir_all(&with_manifest).unwrap();
        std::fs::create_dir_all(&without_manifest).unwrap();
        std::fs::write(with_manifest.join("manifest.json"), "{}").unwrap();

        let resolved = resolve_from_base(base.path());
        assert_eq!(resolved, vec![with_manifest]);
    }

    /// A base without any installed example resolves to nothing.
    #[test]
    fn resolves_nothing_without_examples() {
        let base = tempfile::tempdir().unwrap();

        assert!(resolve_from_base(base.path()).is_empty());
    }
}
