//! Built-in utility tools (v1.2.0, issue #18).
//!
//! The Utilities folder's three tools (v1.3.0, issue #55: LND, MSG and
//! the newly added TND) are pinned by the committed registry
//! (`utilities.json` at the repository root) and shipped UNPACKED with the
//! app resources: `scripts/fetch-utilities.mjs` (chained into
//! beforeBuildCommand) downloads each tool's pinned `.pnds` release,
//! verifies its sha256 (a mismatch fails the build), and unpacks the
//! project into the stable path `utilities/<id>/` — no version in the path,
//! so app updates swap the contents without ever stale-dating the history
//! entries. The app runs the tools IN PLACE from the resources; there is no
//! first-run install into the app data directory (Project Bundle
//! Specification §5 records this decision). Opening one runs the standard
//! preflight → spawn → health → monitor session flow.
//!
//! When nothing is staged (a dev checkout that has not run
//! `npm run utilities:fetch`), the repository's `utilities/` mirrors are
//! used instead, so `tauri dev` still has a working Utilities folder.

use serde::Deserialize;
use specta::Type;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Directory names of the repository utility mirrors, in Utilities order —
/// the dev fallback when no staged tool resources exist.
const UTILITY_NAMES: [&str; 2] = ["Local Network Diagnostics", "Multichannel Signal Generator"];

/// The parsed registry file (repo root `utilities.json`).
#[derive(Debug, Deserialize)]
struct RegistryFile {
    tools: Vec<ToolEntry>,
}

/// One registry entry: where a tool's `.pnds` release lives and the
/// checksum the build-time fetch verified. Embedded at compile time.
#[derive(Debug, Clone, Deserialize)]
pub struct ToolEntry {
    pub id: String,
    pub repo: String,
    pub tag: String,
    pub artifact: String,
    pub sha256: String,
}

/// One tool as the frontend sees it: the stable project path inside the app
/// resources and its manifest-declared display name.
#[derive(Debug, Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinUtility {
    /// Absolute path of the unpacked tool project, run in place.
    pub path: String,
    /// The manifest-declared display name, so a clean install lists the
    /// Utilities entries by name before their first preflight.
    pub name: String,
}

/// The registry behind the Utilities folder, in Utilities order. Parsed
/// once; a malformed committed registry is an authoring error and surfaces
/// as a command error rather than a panic.
pub fn builtin_tool_registry() -> Result<&'static [ToolEntry], String> {
    static REGISTRY: std::sync::OnceLock<Result<Vec<ToolEntry>, String>> =
        std::sync::OnceLock::new();
    REGISTRY
        .get_or_init(|| {
            let json = include_str!("../../../utilities.json");
            let parsed: RegistryFile = serde_json::from_str(json)
                .map_err(|e| format!("utilities.json is not valid: {e}"))?;
            validate_registry(&parsed.tools)?;
            Ok(parsed.tools)
        })
        .as_deref()
        .map_err(Clone::clone)
}

/// Structural checks mirroring the fetch script's parser: unique ids and
/// well-formed checksums, so a bad edit fails loudly on both sides.
fn validate_registry(tools: &[ToolEntry]) -> Result<(), String> {
    let mut seen: Vec<&str> = Vec::new();
    for entry in tools {
        if entry.id.is_empty()
            || entry.repo.is_empty()
            || entry.tag.is_empty()
            || entry.artifact.is_empty()
        {
            return Err(format!(
                "utilities.json: every field of tool \"{id}\" must be non-empty",
                id = entry.id
            ));
        }
        if entry.sha256.len() != 64 || !entry.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "utilities.json: tool \"{id}\" has a malformed sha256",
                id = entry.id
            ));
        }
        if seen.contains(&entry.id.as_str()) {
            return Err(format!(
                "utilities.json: duplicate tool id \"{id}\"",
                id = entry.id
            ));
        }
        seen.push(&entry.id);
    }
    Ok(())
}

/// Resolves the staged utility folders under `staged_dir`, in registry
/// order. An entry without a staged folder (or with an unreadable
/// manifest) is skipped — it cannot be run, so it must not be listed.
pub fn resolve_staged_utilities(registry: &[ToolEntry], staged_dir: &Path) -> Vec<BuiltinUtility> {
    registry
        .iter()
        .filter_map(|entry| {
            let dir = staged_dir.join(&entry.id);
            match crate::project::manifest::load_manifest(&dir) {
                Ok(manifest) => Some(BuiltinUtility {
                    path: dir.to_string_lossy().into_owned(),
                    name: manifest.name,
                }),
                Err(error) => {
                    log::debug!(
                        "Built-in tool {id} is not resolvable in {dir}: {error}",
                        id = entry.id,
                        dir = staged_dir.display()
                    );
                    None
                }
            }
        })
        .collect()
}

/// Roots that may hold the staged `utilities/` resources, most specific
/// first: the app bundle's resources (release), then — in debug builds
/// only — the repository checkout a local `npm run utilities:fetch`
/// unpacked into.
fn staged_dir_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("utilities"));
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/utilities"));
    candidates
}

/// Roots that may hold the `utilities/` tree for the dev fallback: the app
/// bundle's resources (release), then — in debug builds only — the
/// repository checkout that `tauri dev` runs from.
fn utilities_base_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources);
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    candidates
}

/// Utility project directories under `base` that contain a manifest — a
/// missing entry is skipped rather than seeding a dead path.
fn resolve_from_base(base: &Path) -> Vec<PathBuf> {
    UTILITY_NAMES
        .iter()
        .map(|name| base.join("utilities").join(name))
        .filter(|path| path.join("manifest.json").is_file())
        .collect()
}

/// v1.2.0 (issue #18): the built-in utility tools behind the Utilities
/// folder. Returns each tool's stable project path (run in place from the
/// app resources) and manifest name, in registry order. With nothing staged
/// (a dev checkout), the repository's utility mirrors are returned instead.
#[tauri::command]
#[specta::specta]
pub async fn builtin_utilities(app: AppHandle) -> Result<Vec<BuiltinUtility>, String> {
    let registry = builtin_tool_registry()?;
    let mut saw_staging = false;
    for staged_dir in staged_dir_candidates(&app) {
        if !staged_dir.is_dir() {
            continue;
        }
        saw_staging = true;
        let utilities = resolve_staged_utilities(registry, &staged_dir);
        if !utilities.is_empty() {
            return Ok(utilities);
        }
    }
    if saw_staging {
        // Staged resources exist but nothing resolves — a corrupted or
        // registry-mismatched app bundle. Loud beats silently hiding the
        // Utilities folder.
        return Err(
            "The built-in utilities could not be resolved from the app resources".to_string(),
        );
    }
    // Nothing staged (a dev checkout without `npm run utilities:fetch`):
    // fall back to the repository mirrors so `tauri dev` still has a
    // Utilities folder. In release builds this resolves to nothing.
    let dev_tools = utilities_base_candidates(&app)
        .iter()
        .find_map(|base| {
            let resolved = resolve_from_base(base);
            (!resolved.is_empty()).then_some(resolved)
        })
        .unwrap_or_default();
    Ok(dev_tools
        .into_iter()
        .map(|path| {
            let dir_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name = crate::project::manifest::load_manifest(&path)
                .map(|manifest| manifest.name)
                .unwrap_or(dir_name);
            BuiltinUtility {
                path: path.to_string_lossy().into_owned(),
                name,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn entry(id: &str) -> ToolEntry {
        ToolEntry {
            id: id.to_string(),
            repo: "xO-xN/Fixture".to_string(),
            tag: "v1.0.0".to_string(),
            artifact: format!("{id}-v1.0.0.pnds"),
            sha256: "0".repeat(64),
        }
    }

    /// A staged utility folder with a valid manifest, as the fetch script
    /// unpacks it: `<staged>/<id>/manifest.json`.
    fn stage_fixture_utility(staged_dir: &Path, id: &str, name: &str) {
        let dir = staged_dir.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("server.js"), "// score server").unwrap();
        fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{
                    "schemaVersion": 1,
                    "id": "{id}",
                    "name": "{name}",
                    "version": "1.0.0",
                    "scoreServer": {{
                        "entry": "server.js",
                        "workingDirectory": ".",
                        "performerPort": 6868,
                        "monitorPort": 6869
                    }},
                    "audio": {{ "defaultMode": "none", "supportedModes": ["none"] }}
                }}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn resolves_staged_utilities_in_registry_order() {
        let staged = tempfile::tempdir().unwrap();
        stage_fixture_utility(staged.path(), "first-tool", "First Tool");
        stage_fixture_utility(staged.path(), "second-tool", "Second Tool");

        let utilities =
            resolve_staged_utilities(&[entry("second-tool"), entry("first-tool")], staged.path());

        assert_eq!(
            utilities
                .iter()
                .map(|u| u.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                staged.path().join("second-tool").to_string_lossy().as_ref(),
                staged.path().join("first-tool").to_string_lossy().as_ref(),
            ],
            "registry order rules, not the directory listing"
        );
        assert_eq!(utilities[0].name, "Second Tool");
        assert_eq!(utilities[1].name, "First Tool");
    }

    #[test]
    fn skips_entries_without_a_valid_manifest() {
        let staged = tempfile::tempdir().unwrap();
        stage_fixture_utility(staged.path(), "good-tool", "Good Tool");
        // Unstaged entry and a folder with a broken manifest are skipped.
        fs::create_dir_all(staged.path().join("bad-tool")).unwrap();
        fs::write(staged.path().join("bad-tool/manifest.json"), "{").unwrap();

        let utilities = resolve_staged_utilities(
            &[
                entry("good-tool"),
                entry("unstaged-tool"),
                entry("bad-tool"),
            ],
            staged.path(),
        );

        assert_eq!(utilities.len(), 1);
        assert_eq!(utilities[0].name, "Good Tool");
    }

    /// The committed registry: parses, orders the three real tools, and pins
    /// well-formed checksums the fetch script verified at build time.
    #[test]
    fn embedded_registry_pins_the_three_tools() {
        let registry = builtin_tool_registry().unwrap();
        assert_eq!(
            registry.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            [
                "local-network-diagnostics",
                "multichannel-signal-generator",
                "telematic-network-diagnostics"
            ],
            "registry order is the Utilities order"
        );
        for tool in registry {
            assert_eq!(tool.sha256.len(), 64);
            assert!(tool.repo.contains('/'), "repo must be owner/name");
            assert!(tool.artifact.ends_with(".pnds"));
        }
    }

    #[test]
    fn registry_validation_rejects_duplicates_and_bad_checksums() {
        let mut duplicate = vec![entry("a"), entry("a")];
        assert!(validate_registry(&duplicate).is_err());

        duplicate[1].id = "b".to_string();
        duplicate[1].sha256 = "abc".to_string();
        assert!(validate_registry(&duplicate).is_err());

        duplicate[1].sha256 = "1".repeat(64);
        assert!(validate_registry(&duplicate).is_ok());
    }

    #[test]
    fn dev_fallback_resolves_only_manifest_carrying_utilities() {
        let base = tempfile::tempdir().unwrap();
        let with_manifest = base.path().join("utilities").join(UTILITY_NAMES[0]);
        let without_manifest = base.path().join("utilities").join(UTILITY_NAMES[1]);
        fs::create_dir_all(&with_manifest).unwrap();
        fs::create_dir_all(&without_manifest).unwrap();
        fs::write(with_manifest.join("manifest.json"), "{}").unwrap();

        let resolved = resolve_from_base(base.path());
        assert_eq!(resolved, vec![with_manifest]);
    }

    #[test]
    fn dev_fallback_resolves_nothing_without_utilities() {
        let base = tempfile::tempdir().unwrap();
        assert!(resolve_from_base(base.path()).is_empty());
    }
}
