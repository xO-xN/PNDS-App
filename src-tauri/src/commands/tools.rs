//! Built-in utility tools (v1.2.0, issue #18).
//!
//! The Utilities folder's two tools are pinned by the committed registry
//! (`builtin-tools.json` at the repository root) and shipped as `.pnds`
//! bundles under the app resources (`builtin-tools/<id>.pnds`), staged at
//! build time by `scripts/fetch-builtin-tools.mjs` (download → sha256 gate
//! → .pnds layout). On first run they install into the app-managed
//! `bundles/` directory through the ordinary bundle install path (Project
//! Bundle Specification §5), and the frontend lists the installed
//! directories in the Utilities folder — opening one runs the standard
//! preflight → spawn → health → monitor session flow.
//!
//! When nothing is staged (a dev checkout that has not run
//! `npm run tools:fetch`), the repository's `examples/` mirrors are used
//! in place, so `tauri dev` still has a working Utilities folder.

use serde::Deserialize;
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::project::bundle;

/// Directory names of the repository example mirrors, in Utilities order —
/// the dev fallback when no staged tool resources exist.
const EXAMPLE_NAMES: [&str; 2] = ["Local Network Diagnostics", "Multichannel Signal Generator"];

/// The parsed registry file (repo root `builtin-tools.json`).
#[derive(Debug, Deserialize)]
struct RegistryFile {
    tools: Vec<ToolEntry>,
}

/// One registry entry: where a tool's release artifact lives and the
/// checksum the build-time fetch verified. Embedded at compile time.
#[derive(Debug, Clone, Deserialize)]
pub struct ToolEntry {
    pub id: String,
    pub repo: String,
    pub tag: String,
    pub artifact: String,
    pub sha256: String,
}

/// One tool as the frontend sees it after a sync.
#[derive(Debug, Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinTool {
    /// Absolute path of the installed (or dev-resolved) tool project.
    pub path: String,
    /// The manifest-declared display name, so a clean install lists the
    /// Utilities entries by name before their first preflight.
    pub name: String,
    /// Install directories of older registry versions reclaimed by this
    /// sync — the frontend prunes them from the history and folder
    /// membership so no dead entries linger after an app update.
    pub superseded_paths: Vec<String>,
}

/// The registry behind the Utilities folder, in Utilities order. Parsed
/// once; a malformed committed registry is an authoring error and surfaces
/// as a command error rather than a panic.
pub fn builtin_tool_registry() -> Result<&'static [ToolEntry], String> {
    static REGISTRY: std::sync::OnceLock<Result<Vec<ToolEntry>, String>> =
        std::sync::OnceLock::new();
    REGISTRY
        .get_or_init(|| {
            let json = include_str!("../../../builtin-tools.json");
            let parsed: RegistryFile = serde_json::from_str(json)
                .map_err(|e| format!("builtin-tools.json is not valid: {e}"))?;
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
                "builtin-tools.json: every field of tool \"{id}\" must be non-empty",
                id = entry.id
            ));
        }
        if entry.sha256.len() != 64 || !entry.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "builtin-tools.json: tool \"{id}\" has a malformed sha256",
                id = entry.id
            ));
        }
        if seen.contains(&entry.id.as_str()) {
            return Err(format!(
                "builtin-tools.json: duplicate tool id \"{id}\"",
                id = entry.id
            ));
        }
        seen.push(&entry.id);
    }
    Ok(())
}

/// Installs every staged registry tool into `bundles_root`, skipping tools
/// whose registry version is already installed and reclaiming stale
/// same-id installs of other versions. A tool that fails to install is
/// logged and skipped — one broken resource must not hide the others.
pub fn sync_tools_from_staging(
    registry: &[ToolEntry],
    staged_dir: &Path,
    bundles_root: &Path,
) -> Vec<BuiltinTool> {
    let mut tools = Vec::new();
    for entry in registry {
        let staged = staged_dir.join(format!("{id}.pnds", id = entry.id));
        if !staged.is_file() {
            log::debug!(
                "Built-in tool {id} is not staged in {dir}",
                id = entry.id,
                dir = staged_dir.display()
            );
            continue;
        }
        match sync_one_tool(&staged, bundles_root) {
            Ok(tool) => tools.push(tool),
            Err(error) => log::warn!(
                "Built-in tool {id} could not be installed: {error}",
                id = entry.id
            ),
        }
    }
    tools
}

fn sync_one_tool(staged: &Path, bundles_root: &Path) -> Result<BuiltinTool, String> {
    let (_, id, version) = bundle::bundle_identity(staged)?;
    let install_dir = bundles_root.join(format!("{id}-{version}"));
    if install_is_current(&install_dir, &id, &version) {
        log::debug!("Built-in tool {id}-{version} is already installed");
    } else {
        bundle::install_bundle(bundles_root, staged)?;
        log::info!(
            "Installed built-in tool {id}-{version} from {path}",
            path = staged.display()
        );
    }

    // The registry version is the truth for built-in tools: same-id installs
    // at other versions are stale and get reclaimed so `bundles/` does not
    // accumulate garbage across app updates. The directory-name prefix is
    // only the candidate filter — a sibling is only deleted once its own
    // manifest confirms it is the same tool (another tool whose id merely
    // extends this one's must survive).
    let prefix = format!("{id}-");
    let current = install_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut superseded_paths = Vec::new();
    if let Ok(entries) = fs::read_dir(bundles_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == current || !name.starts_with(&prefix) || !entry.path().is_dir() {
                continue;
            }
            let stale = entry.path();
            if dir_manifest_id(&stale).as_deref() != Some(id.as_str()) {
                continue;
            }
            match fs::remove_dir_all(&stale) {
                Ok(()) => superseded_paths.push(stale.to_string_lossy().into_owned()),
                Err(e) => log::warn!(
                    "Failed to reclaim the stale built-in install {path}: {e}",
                    path = stale.display()
                ),
            }
        }
    }
    Ok(BuiltinTool {
        path: install_dir.to_string_lossy().into_owned(),
        name: tool_display_name(&install_dir, &id),
        superseded_paths,
    })
}

/// The manifest id of an extracted install, without full validation — the
/// reclamation filter only needs the identity.
fn dir_manifest_id(dir: &Path) -> Option<String> {
    let body = fs::read_to_string(dir.join("manifest.json")).ok()?;
    let manifest = serde_json::from_str::<serde_json::Value>(&body).ok()?;
    manifest
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// The manifest name of an installed tool, falling back to its id when the
/// manifest cannot be read (the install path already validated it, so this
/// only guards against concurrent removal).
fn tool_display_name(install_dir: &Path, id: &str) -> String {
    crate::project::manifest::load_manifest(install_dir)
        .map(|manifest| manifest.name)
        .unwrap_or_else(|_| id.to_string())
}

/// True when `dir` holds a valid install of exactly this id+version — the
/// launch-time fast path that keeps re-runs from re-extracting.
fn install_is_current(dir: &Path, id: &str, version: &str) -> bool {
    match crate::project::manifest::load_manifest(dir) {
        Ok(manifest) => manifest.id == id && manifest.version == version,
        Err(_) => false,
    }
}

/// Roots that may hold the staged `builtin-tools/` resources, most specific
/// first: the app bundle's resources (release), then — in debug builds
/// only — the repository checkout a local `npm run tools:fetch` staged into.
fn staged_dir_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("builtin-tools"));
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/builtin-tools"));
    candidates
}

/// Roots that may hold the `examples/` tree for the dev fallback: the app
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

/// v1.2.0 (issue #18): syncs the built-in utility tools. Installs the
/// staged `.pnds` resources into the app-managed `bundles/` directory on
/// first run (no-op once the registry version is installed), reclaims
/// installs of superseded versions, and returns the tool project paths in
/// Utilities order. With nothing staged (a dev checkout), the repository's
/// example mirrors are returned in place.
#[tauri::command]
#[specta::specta]
pub async fn sync_builtin_tools(app: AppHandle) -> Result<Vec<BuiltinTool>, String> {
    let bundles_root = crate::commands::bundle::bundles_root(&app)?;
    let registry = builtin_tool_registry()?;
    let mut saw_staging = false;
    for staged_dir in staged_dir_candidates(&app) {
        if !staged_dir.is_dir() {
            continue;
        }
        saw_staging = true;
        let tools = sync_tools_from_staging(registry, &staged_dir, &bundles_root);
        if !tools.is_empty() {
            return Ok(tools);
        }
    }
    if saw_staging {
        // Staged resources exist but nothing installed — a corrupted or
        // registry-mismatched app bundle. Loud beats silently hiding the
        // Utilities folder (the per-tool warnings carry the causes).
        return Err("The built-in tools could not be installed from the app resources".to_string());
    }
    // Nothing staged (a dev checkout without `npm run tools:fetch`): fall
    // back to the repository mirrors so `tauri dev` still has a Utilities
    // folder. In release builds this resolves to nothing.
    let dev_tools = example_base_candidates(&app)
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
            BuiltinTool {
                name: tool_display_name(&path, &dir_name),
                path: path.to_string_lossy().into_owned(),
                superseded_paths: Vec::new(),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> ToolEntry {
        ToolEntry {
            id: id.to_string(),
            repo: "xO-xN/Fixture".to_string(),
            tag: "v1.0.0".to_string(),
            artifact: format!("{id}-v1.0.0.zip"),
            sha256: "0".repeat(64),
        }
    }

    /// Packs a minimal none-mode project and stages it as `<id>.pnds`,
    /// mirroring what the fetch script lays down.
    fn stage_fixture_tool(work: &Path, id: &str, version: &str) {
        let project = work.join("src").join(id);
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("server.js"), "// score server").unwrap();
        fs::write(
            project.join("manifest.json"),
            format!(
                r#"{{
                    "schemaVersion": 1,
                    "id": "{id}",
                    "name": "Fixture Tool {version}",
                    "version": "{version}",
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
        let packed = bundle::pack_project(&project, false, "test").unwrap();
        let staged_dir = work.join("builtin-tools");
        fs::create_dir_all(&staged_dir).unwrap();
        fs::copy(packed.output_path, staged_dir.join(format!("{id}.pnds"))).unwrap();
    }

    #[test]
    fn installs_staged_tools_into_bundles() {
        let work = tempfile::tempdir().unwrap();
        stage_fixture_tool(work.path(), "fixture-tool", "1.0.0");
        let staged_dir = work.path().join("builtin-tools");
        let bundles = work.path().join("bundles");

        let tools = sync_tools_from_staging(&[entry("fixture-tool")], &staged_dir, &bundles);

        let installed = bundles.join("fixture-tool-1.0.0");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].path, installed.to_string_lossy());
        assert_eq!(tools[0].name, "Fixture Tool 1.0.0");
        assert!(tools[0].superseded_paths.is_empty());
        assert!(installed.join("manifest.json").is_file());
        crate::project::manifest::load_manifest(&installed).unwrap();
    }

    #[test]
    fn skips_reinstall_when_registry_version_is_current() {
        let work = tempfile::tempdir().unwrap();
        stage_fixture_tool(work.path(), "fixture-tool", "1.0.0");
        let staged_dir = work.path().join("builtin-tools");
        let bundles = work.path().join("bundles");
        let registry = vec![entry("fixture-tool")];
        sync_tools_from_staging(&registry, &staged_dir, &bundles);

        // A marker inside the install survives a second sync only when the
        // sync skipped the reinstall (a reinstall deletes the directory).
        let installed = bundles.join("fixture-tool-1.0.0");
        fs::write(installed.join("marker.txt"), "keep me").unwrap();

        let tools = sync_tools_from_staging(&registry, &staged_dir, &bundles);

        assert_eq!(tools[0].path, installed.to_string_lossy());
        assert!(installed.join("marker.txt").is_file());
    }

    #[test]
    fn reclaims_stale_versions_on_bump() {
        let work = tempfile::tempdir().unwrap();
        stage_fixture_tool(work.path(), "fixture-tool", "1.0.0");
        let staged_dir = work.path().join("builtin-tools");
        let bundles = work.path().join("bundles");
        let registry = vec![entry("fixture-tool")];
        sync_tools_from_staging(&registry, &staged_dir, &bundles);
        let old = bundles.join("fixture-tool-1.0.0");
        assert!(old.is_dir());

        // The next registry pins 2.0.0: the old install is reclaimed and
        // reported so the frontend can prune its history entry.
        stage_fixture_tool(work.path(), "fixture-tool", "2.0.0");
        let tools = sync_tools_from_staging(&registry, &staged_dir, &bundles);

        assert_eq!(
            tools[0].path,
            bundles.join("fixture-tool-2.0.0").to_string_lossy()
        );
        assert!(!old.exists(), "stale version dir must be reclaimed");
        assert_eq!(
            tools[0].superseded_paths,
            vec![old.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn reclamation_spares_sibling_ids_that_extend_the_tool_id() {
        let work = tempfile::tempdir().unwrap();
        stage_fixture_tool(work.path(), "fixture-tool", "1.0.0");
        let staged_dir = work.path().join("builtin-tools");
        let bundles = work.path().join("bundles");
        // A different tool whose id merely extends "fixture-tool": the
        // directory-name prefix alone must not get it reclaimed.
        let sibling = bundles.join("fixture-tool-pro-9.9.9");
        fs::create_dir_all(&sibling).unwrap();
        fs::write(
            sibling.join("manifest.json"),
            r#"{ "id": "fixture-tool-pro", "version": "9.9.9" }"#,
        )
        .unwrap();

        let tools = sync_tools_from_staging(&[entry("fixture-tool")], &staged_dir, &bundles);

        assert!(
            sibling.is_dir(),
            "a longer sibling id must not be reclaimed"
        );
        assert!(tools[0].superseded_paths.is_empty());
    }

    #[test]
    fn skips_corrupt_staged_bundle_but_installs_the_rest() {
        let work = tempfile::tempdir().unwrap();
        stage_fixture_tool(work.path(), "good-tool", "1.0.0");
        let staged_dir = work.path().join("builtin-tools");
        fs::write(staged_dir.join("bad-tool.pnds"), b"not a zip").unwrap();
        let bundles = work.path().join("bundles");

        let tools = sync_tools_from_staging(
            &[entry("bad-tool"), entry("good-tool")],
            &staged_dir,
            &bundles,
        );

        assert_eq!(
            tools.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(),
            vec![bundles.join("good-tool-1.0.0").to_string_lossy().as_ref()],
            "only the healthy tool is returned"
        );
        assert!(bundles.join("good-tool-1.0.0").is_dir());
    }

    #[test]
    fn unstaged_registry_entries_are_skipped() {
        let work = tempfile::tempdir().unwrap();
        let staged_dir = work.path().join("builtin-tools");
        fs::create_dir_all(&staged_dir).unwrap();

        let tools = sync_tools_from_staging(
            &[entry("fixture-tool")],
            &staged_dir,
            &work.path().join("bundles"),
        );

        assert!(tools.is_empty());
    }

    /// The committed registry: parses, orders the two real tools, and pins
    /// well-formed checksums the fetch script verified at build time.
    #[test]
    fn embedded_registry_pins_the_two_tools() {
        let registry = builtin_tool_registry().unwrap();
        assert_eq!(
            registry.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["local-network-diagnostics", "multichannel-signal-generator"],
            "registry order is the Utilities order"
        );
        for tool in registry {
            assert_eq!(tool.sha256.len(), 64);
            assert!(tool.repo.contains('/'), "repo must be owner/name");
            assert!(!tool.artifact.is_empty());
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
    fn dev_fallback_resolves_only_manifest_carrying_examples() {
        let base = tempfile::tempdir().unwrap();
        let with_manifest = base.path().join("examples").join(EXAMPLE_NAMES[0]);
        let without_manifest = base.path().join("examples").join(EXAMPLE_NAMES[1]);
        fs::create_dir_all(&with_manifest).unwrap();
        fs::create_dir_all(&without_manifest).unwrap();
        fs::write(with_manifest.join("manifest.json"), "{}").unwrap();

        let resolved = resolve_from_base(base.path());
        assert_eq!(resolved, vec![with_manifest]);
    }

    #[test]
    fn dev_fallback_resolves_nothing_without_examples() {
        let base = tempfile::tempdir().unwrap();
        assert!(resolve_from_base(base.path()).is_empty());
    }
}
