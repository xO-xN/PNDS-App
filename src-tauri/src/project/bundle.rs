//! PNDS `.pnds` project bundle service (v1.2.0, issue #16).
//!
//! Implements `docs/zh-CN/reference/pnds-bundle.md`: a `.pnds` file is
//! a zip(deflate) archive holding exactly one root directory with the
//! complete runnable project plus a top-level `pnds-bundle.json`. It is a
//! transport container only — sessions always run from the extracted
//! directory, so compression never affects runtime behavior.
//!
//! All functions here are path-based (no AppHandle) so the pack / install /
//! reclaim flows are testable with tempdir fixtures.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;
use zip::ZipWriter;

use crate::project::manifest::Manifest;

/// The bundle format version this App writes and accepts .
pub const BUNDLE_FORMAT_VERSION: u32 = 1;

/// Top-level metadata entry inside every `.pnds` .
pub const METADATA_ENTRY: &str = "pnds-bundle.json";

/// App-managed install root under the app data dir .
pub const BUNDLES_DIR: &str = "bundles";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleMetadata {
    pub format_version: u32,
    pub packed_with: String,
    pub packed_at: String,
    pub source_platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleOutputInfo {
    pub output_path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    pub output_path: String,
    pub sha256: String,
}

// ───────────────────────────── packing ─────────────────────────────

/// The shared packability gate : full manifest validation (which
/// intercepts missing synthdef artifacts), the production-dependency /
/// node_modules check, and the output path derivation. The pack UI's
/// pre-check and the pack itself must agree, so both go through here.
pub fn validate_packable(project_root: &Path) -> Result<(Manifest, PathBuf), String> {
    if !project_root.is_dir() {
        return Err(format!(
            "Project directory not found: {}",
            project_root.display()
        ));
    }
    let manifest = crate::project::manifest::load_manifest(project_root)?;
    crate::project::preflight::check_dependencies(project_root)?;
    let output = bundle_output_path(project_root, &manifest)?;
    Ok((manifest, output))
}

/// Packs the project at `project_root` into `<parent>/<name>-<version>.pnds`.
///
/// Preflight: full manifest validation (which intercepts missing synthdef
/// artifacts) and the production-dependency/node_modules check. No npm
/// command ever runs and the source tree is only ever read.
pub fn pack_project(
    project_root: &Path,
    overwrite: bool,
    packed_with: &str,
) -> Result<PackResult, String> {
    let (manifest, output) = validate_packable(project_root)?;
    if output.exists() && !overwrite {
        return Err(format!(
            "A bundle already exists at {}.\nConfirm the overwrite to replace it.",
            output.display()
        ));
    }

    // stage in the system temp dir so the source tree is never touched.
    let staging =
        tempfile::tempdir().map_err(|e| format!("Failed to create the staging directory: {e}"))?;
    let root_name = zip_root_name(&manifest);
    let staged_root = staging.path().join(&root_name);
    copy_runtime_tree(project_root, project_root, &staged_root)?;

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    // write to a sibling temp file, then atomically rename into place.
    let tmp_output = output.with_file_name(format!(
        ".{}.part",
        output
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
    ));
    let write_result = write_bundle_zip(&staged_root, &root_name, packed_with, &tmp_output);
    match write_result {
        Ok(()) => {
            fs::rename(&tmp_output, &output)
                .map_err(|e| format!("Failed to finalize {}: {e}", output.display()))?;
        }
        Err(error) => {
            let _ = fs::remove_file(&tmp_output);
            return Err(error);
        }
    }

    let sha256 = sha256_hex(&output)?;
    Ok(PackResult {
        output_path: output.to_string_lossy().into_owned(),
        sha256,
    })
}

/// The `<parent>/<sanitized name>-<version>.pnds` path for a project
/// . Also the "does it already exist" probe the UI confirms with.
pub fn bundle_output_path(project_root: &Path, manifest: &Manifest) -> Result<PathBuf, String> {
    let name = sanitize_name_component(&manifest.name);
    if name.is_empty() {
        return Err("manifest.json \"name\" must not be empty".to_string());
    }
    ensure_path_segment(&manifest.version, "version")?;
    let parent = project_root
        .parent()
        .ok_or_else(|| "The project directory has no parent".to_string())?;
    Ok(parent.join(format!("{name}-{version}.pnds", version = manifest.version)))
}

/// Zip root directory name: the sanitized project display name, falling
/// back to the id (openers must not depend on this name).
fn zip_root_name(manifest: &Manifest) -> String {
    let name = sanitize_name_component(&manifest.name);
    if name.is_empty() {
        sanitize_name_component(&manifest.id)
    } else {
        name
    }
}

/// Replaces filename-hostile characters with `-` .
fn sanitize_name_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    cleaned.trim().trim_matches('.').to_string()
}

/// A manifest value that becomes a single directory/file name segment must
/// not contain separators or traversal (also guards install dirs).
fn ensure_path_segment(value: &str, field: &str) -> Result<(), String> {
    let invalid = value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\');
    if invalid {
        return Err(format!(
            "manifest.json \"{field}\" must be a single path segment: \"{value}\""
        ));
    }
    Ok(())
}

/// True for entries the bundle never carries . `.DS_Store` and
/// `.git*` are junk at any depth; `docs/` / `test/` / `tests/` are only
/// dropped at the project root (deeper directories are runtime assets).
fn is_excluded(name: &str, is_dir: bool, at_root: bool) -> bool {
    if name == ".DS_Store" || name.starts_with(".git") {
        return true;
    }
    is_dir && at_root && matches!(name, "docs" | "test" | "tests")
}

/// Copies the runtime tree from `src` into `dst_root`. In-root symlink
/// targets are materialized as regular files/directories (via `fs::copy`,
/// which follows the link and preserves the target's unix permission bits);
/// out-of-root symlinks are skipped — they would be broken on any other
/// machine anyway .
fn copy_runtime_tree(src_root: &Path, src: &Path, dst: &Path) -> Result<(), String> {
    let canonical_root = src_root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve {}: {e}", src_root.display()))?;
    copy_dir(src, &canonical_root, true, dst)
}

/// `is_project_root` marks the recursion level where the root-only
/// exclusions (docs/test/tests) apply.
fn copy_dir(
    src: &Path,
    canonical_root: &Path,
    is_project_root: bool,
    dst: &Path,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create {}: {e}", dst.display()))?;
    let mut entries: Vec<_> = fs::read_dir(src)
        .map_err(|e| format!("Failed to read {}: {e}", src.display()))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let src_path = entry.path();
        // DirEntry::metadata does not follow symlinks, so file_type()
        // below correctly reports symlink entries.
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to stat {}: {e}", src_path.display()))?;
        if metadata.is_dir() {
            if is_excluded(&name, true, is_project_root) {
                continue;
            }
            copy_dir(&src_path, canonical_root, false, &dst.join(&name))?;
            continue;
        }
        if is_excluded(&name, false, is_project_root) {
            continue;
        }
        if metadata.file_type().is_symlink() {
            let Ok(target) = fs::canonicalize(&src_path) else {
                continue; // broken symlink — nothing to carry
            };
            if !target.starts_with(canonical_root) {
                continue; // out-of-root symlink: skip
            }
            if target.is_dir() {
                copy_dir(&target, canonical_root, false, &dst.join(&name))?;
            } else {
                // Follows the link; preserves the target's permission bits.
                fs::copy(&src_path, dst.join(&name))
                    .map_err(|e| format!("Failed to copy {}: {e}", src_path.display()))?;
            }
        } else {
            fs::copy(&src_path, dst.join(&name))
                .map_err(|e| format!("Failed to copy {}: {e}", src_path.display()))?;
        }
    }
    Ok(())
}

fn write_bundle_zip(
    staged_root: &Path,
    root_name: &str,
    packed_with: &str,
    output: &Path,
) -> Result<(), String> {
    let file =
        File::create(output).map_err(|e| format!("Failed to create {}: {e}", output.display()))?;
    let mut writer = ZipWriter::new(file);

    let metadata = BundleMetadata {
        format_version: BUNDLE_FORMAT_VERSION,
        packed_with: packed_with.to_string(),
        packed_at: rfc3339_utc_now(),
        source_platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
    };
    writer
        .start_file(
            METADATA_ENTRY,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|e| format!("Failed to write {METADATA_ENTRY}: {e}"))?;
    writer
        .write_all(serde_json::to_string_pretty(&metadata).unwrap().as_bytes())
        .map_err(|e| format!("Failed to write {METADATA_ENTRY}: {e}"))?;

    add_tree_to_zip(&mut writer, root_name, staged_root, staged_root)?;
    writer
        .finish()
        .map_err(|e| format!("Failed to finalize {}: {e}", output.display()))?;
    Ok(())
}

fn add_tree_to_zip(
    writer: &mut ZipWriter<File>,
    root_name: &str,
    base: &Path,
    dir: &Path,
) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let src_path = entry.path();
        let rel = src_path
            .strip_prefix(base)
            .map_err(|_| "internal: zip path escape".to_string())?;
        // Zip names always use forward slashes.
        let rel_name = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let entry_name = format!("{root_name}/{rel_name}");
        // DirEntry::metadata does not follow symlinks, so file_type()
        // below correctly reports symlink entries.
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to stat {}: {e}", src_path.display()))?;
        let mut options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            // zip64 headers cost 20 B for small files but make huge
            // node_modules payloads possible.
            .large_file(true);
        if metadata.is_dir() {
            // Explicit directory entries keep empty runtime directories in
            // the archive (original structure preserved).
            #[cfg(unix)]
            let dir_options = options.unix_permissions(0o755);
            #[cfg(not(unix))]
            let dir_options = options;
            writer
                .add_directory(&entry_name, dir_options)
                .map_err(|e| format!("Failed to add {rel_name} to the bundle: {e}"))?;
            add_tree_to_zip(writer, root_name, base, &src_path)?;
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            options = options.unix_permissions(metadata.permissions().mode() & 0o777);
        }
        writer
            .start_file(entry_name, options)
            .map_err(|e| format!("Failed to add {rel_name} to the bundle: {e}"))?;
        let mut file = File::open(&src_path)
            .map_err(|e| format!("Failed to read {}: {e}", src_path.display()))?;
        std::io::copy(&mut file, writer)
            .map_err(|e| format!("Failed to write {rel_name} into the bundle: {e}"))?;
    }
    Ok(())
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

/// RFC 3339 UTC timestamp without a date dependency: the civil-from-days
/// conversion is the standard Howard Hinnant algorithm.
fn rfc3339_utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z",
        h = rem / 3600,
        m = (rem % 3600) / 60,
        s = rem % 60
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

// ──────────────────────────── installing ───────────────────────────

/// Validates the bundle at `bundle_path` and installs it into
/// `<bundles_root>/<id>-<version>/` (always a full reinstall when the
/// directory already exists). Returns the installed project directory.
pub fn install_bundle(bundles_root: &Path, bundle_path: &Path) -> Result<PathBuf, String> {
    let file = File::open(bundle_path)
        .map_err(|e| format!("Cannot open the bundle {}: {e}", bundle_path.display()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Not a valid .pnds bundle (zip): {e}"))?;
    let (root, id, version) = archive_identity(&mut archive)?;

    fs::create_dir_all(bundles_root)
        .map_err(|e| format!("Failed to create {}: {e}", bundles_root.display()))?;
    let target = bundles_root.join(format!("{id}-{version}"));
    // same id+version always reinstalls over the old directory.
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("Failed to replace {}: {e}", target.display()))?;
    }

    if let Err(error) = extract_root_entries(&mut archive, &root, &target).and_then(|()| {
        // Install step 4: the installed project must pass the full manifest
        // check.
        crate::project::manifest::load_manifest(&target)
    }) {
        // Never leave a half-extracted install behind ( (the bundles
        // dir must not accumulate garbage) — the next open retries clean.
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    Ok(target)
}

/// The shared validation prologue: `(root directory, manifest id, version)`.
fn archive_identity(archive: &mut ZipArchive<File>) -> Result<(String, String, String), String> {
    // metadata gate first.
    let metadata: BundleMetadata = archive
        .by_name(METADATA_ENTRY)
        .map_err(|_| format!("The bundle is missing {METADATA_ENTRY}"))
        .and_then(|mut entry| {
            let mut body = String::new();
            entry
                .read_to_string(&mut body)
                .map_err(|e| format!("Failed to read {METADATA_ENTRY}: {e}"))?;
            serde_json::from_str(&body).map_err(|e| format!("{METADATA_ENTRY} is not valid: {e}"))
        })?;
    if metadata.format_version != BUNDLE_FORMAT_VERSION {
        return Err(format!(
            "Unsupported bundle formatVersion {} (this App supports {BUNDLE_FORMAT_VERSION}).",
            metadata.format_version
        ));
    }

    let root = single_root_directory(archive)?;
    let manifest_json = archive
        .by_name(&format!("{root}/manifest.json"))
        .map_err(|_| "The bundle's project is missing manifest.json".to_string())
        .and_then(|mut entry| {
            let mut body = String::new();
            entry
                .read_to_string(&mut body)
                .map_err(|e| format!("Failed to read manifest.json: {e}"))?;
            serde_json::from_str::<serde_json::Value>(&body)
                .map_err(|e| format!("manifest.json is not valid JSON: {e}"))
        })?;
    let id = manifest_json
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("manifest.json is missing the \"id\" field")?
        .to_string();
    let version = manifest_json
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("manifest.json is missing the \"version\" field")?
        .to_string();
    ensure_path_segment(&id, "id")?;
    ensure_path_segment(&version, "version")?;
    Ok((root, id, version))
}

/// The single top-level directory that holds the project . Every
/// other top-level entry must be `pnds-bundle.json`. Standard zip writers
/// emit explicit `<root>/` directory entries; those count as the root, not
/// as stray top-level files.
fn single_root_directory(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let mut roots: Vec<String> = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("Corrupt bundle entry: {e}"))?;
        let is_dir_entry = entry.name().ends_with('/');
        let name = entry.name().trim_end_matches('/');
        let mut components = Path::new(name).components();
        let Some(top) = components.next() else {
            continue;
        };
        let top = top.as_os_str().to_string_lossy().into_owned();
        let deeper = components.next().is_some();
        if !deeper && !is_dir_entry {
            // A top-level file: only the metadata entry may sit there.
            if name == METADATA_ENTRY {
                continue;
            }
            return Err(format!(
                "Unexpected top-level file in the bundle: \"{top}\" (only {METADATA_ENTRY} is allowed)"
            ));
        }
        if !roots.contains(&top) {
            roots.push(top);
        }
    }
    match roots.len() {
        1 => Ok(roots.remove(0)),
        0 => Err("The bundle contains no project directory".to_string()),
        _ => Err(format!(
            "The bundle must contain exactly one project directory (found {})",
            roots.len()
        )),
    }
}

/// Extracts every `<root>/…` entry into `target`, enforcing the zip-slip safety
/// rules: relative paths only, no `..` traversal, no symlink entries.
fn extract_root_entries(
    archive: &mut ZipArchive<File>,
    root: &str,
    target: &Path,
) -> Result<(), String> {
    let prefix = format!("{root}/");
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Corrupt bundle entry: {e}"))?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix(&prefix) else {
            continue; // pnds-bundle.json and any root dir entry itself
        };
        if entry.is_dir() {
            // An explicit `<root>/` (or deeper) directory entry — the empty
            // rel case is the root itself; parents are also created lazily
            // by the file branches below.
            if !rel.is_empty() {
                let dest = target.join(rel);
                fs::create_dir_all(&dest)
                    .map_err(|e| format!("Failed to create {}: {e}", dest.display()))?;
            }
            continue;
        }
        if entry.is_symlink() {
            return Err(format!(
                "The bundle contains a symbolic link entry, which is not allowed: \"{name}\""
            ));
        }
        let rel_path = Path::new(rel);
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            || rel.is_empty()
        {
            return Err(format!(
                "The bundle contains an unsafe entry path: \"{name}\""
            ));
        }
        let dest = target.join(rel_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        let mut out =
            File::create(&dest).map_err(|e| format!("Failed to create {}: {e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Failed to extract \"{name}\": {e}"))?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(mode & 0o777));
        }
    }
    Ok(())
}

// ─────────────────────────── reclaiming ──────────────────────────

/// Deletes the extracted bundle directory behind a history entry, but only
/// when it is a direct child of the App-managed `bundles/` root. Every other
/// path (user disk projects) is left untouched — `Ok(false)`.
pub fn reclaim_bundle_dir(bundles_root: &Path, project_path: &Path) -> Result<bool, String> {
    let Ok(canonical_root) = bundles_root.canonicalize() else {
        return Ok(false); // no bundles dir installed yet — nothing managed
    };
    let Ok(canonical_project) = project_path.canonicalize() else {
        return Ok(false); // already gone (idempotent removal)
    };
    if canonical_project.parent() != Some(&canonical_root) {
        return Ok(false); // not an App-managed install
    }
    fs::remove_dir_all(&canonical_project).map_err(|e| {
        format!(
            "Failed to remove the installed bundle {}: {e}",
            canonical_project.display()
        )
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use zip::write::SimpleFileOptions;

    const APP_VERSION: &str = "1.2.0-test";

    /// A valid internal-mode project (same shape as the manifest tests'
    /// fixture) plus production dependencies and the usual junk to exclude.
    fn fixture_project(dir: &Path) {
        fs::create_dir_all(dir.join("supercollider/synthdefs")).unwrap();
        fs::create_dir_all(dir.join("node_modules/ws")).unwrap();
        fs::write(dir.join("server.js"), "// score server").unwrap();
        fs::write(
            dir.join("supercollider/synthdefs/inarticulate-iii.scsyndef"),
            b"SCgf",
        )
        .unwrap();
        fs::write(dir.join("node_modules/ws/index.js"), "// ws").unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{ "dependencies": { "ws": "^8.0.0" } }"#,
        )
        .unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "id": "inarticulate-iii",
              "name": "Inarticulate III",
              "version": "0.1.0",
              "scoreServer": {
                "entry": "server.js",
                "workingDirectory": ".",
                "performerPort": 6868,
                "monitorPort": 6869
              },
              "audio": {
                "defaultMode": "internal",
                "supportedModes": ["internal", "external", "none"],
                "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
                "scsynth": { "sampleRate": 48000, "blockSize": 64, "audioBusChannels": 128 }
              }
            }"#,
        )
        .unwrap();

        // Junk that must never enter the bundle .
        fs::create_dir_all(dir.join(".git/objects")).unwrap();
        fs::write(dir.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
        fs::write(dir.join(".DS_Store"), b"junk").unwrap();
        fs::write(dir.join("node_modules/.DS_Store"), b"junk").unwrap();
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("docs/notes.md"), "notes").unwrap();
        fs::create_dir_all(dir.join("test")).unwrap();
        fs::write(dir.join("test/spec.js"), "// test").unwrap();
        fs::create_dir_all(dir.join("public/docs")).unwrap();
        fs::write(dir.join("public/docs/guide.html"), "<html>").unwrap();
    }

    /// Packs a fixture project nested under `parent` and returns the
    /// expected output path.
    fn pack_fixture(parent: &Path) -> PathBuf {
        let project = parent.join("Inarticulate III");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);
        pack_project(&project, false, APP_VERSION).unwrap();
        parent.join("Inarticulate III-0.1.0.pnds")
    }

    fn zip_entry_names(path: &Path) -> Vec<String> {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).expect("packed file is a zip");
        (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn pack_creates_sibling_pnds_with_single_root_and_metadata() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        assert!(output.is_file(), "missing {}", output.display());
        assert_eq!(output.file_name().unwrap(), "Inarticulate III-0.1.0.pnds");

        let names = zip_entry_names(&output);
        assert!(names.contains(&"pnds-bundle.json".to_string()), "{names:?}");
        assert!(
            names.contains(&"Inarticulate III/manifest.json".to_string()),
            "{names:?}"
        );
        assert!(
            names.contains(&"Inarticulate III/node_modules/ws/index.js".to_string()),
            "{names:?}"
        );
        // Exclusions: junk at any depth, root-level docs/test dirs.
        for name in &names {
            assert!(!name.contains(".DS_Store"), "{name}");
            assert!(!name.starts_with(".git"), "{name}");
            assert!(!name.contains(".gitignore"), "{name}");
            assert!(!name.starts_with("Inarticulate III/docs/"), "{name}");
            assert!(!name.starts_with("Inarticulate III/test/"), "{name}");
        }
        // A runtime asset named `docs` deeper in the tree survives.
        assert!(
            names.contains(&"Inarticulate III/public/docs/guide.html".to_string()),
            "{names:?}"
        );
    }

    #[test]
    fn pack_metadata_records_format_version_and_packer() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        let mut archive =
            ZipArchive::new(File::open(&output).unwrap()).expect("packed file is a zip");
        let mut entry = archive.by_name(METADATA_ENTRY).unwrap();
        let mut body = String::new();
        entry.read_to_string(&mut body).unwrap();
        let metadata: BundleMetadata = serde_json::from_str(&body).unwrap();
        assert_eq!(metadata.format_version, BUNDLE_FORMAT_VERSION);
        assert_eq!(metadata.packed_with, APP_VERSION);
        assert!(!metadata.packed_at.is_empty());
        assert!(!metadata.source_platform.is_empty());
    }

    #[test]
    fn pack_refuses_missing_node_modules() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);
        fs::remove_dir_all(project.join("node_modules")).unwrap();
        let err = pack_project(&project, false, APP_VERSION).unwrap_err();
        assert!(
            err.contains("Project dependencies are missing"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn pack_intercepts_missing_synthdef_artifact() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);
        fs::remove_file(project.join("supercollider/synthdefs/inarticulate-iii.scsyndef")).unwrap();
        let err = pack_project(&project, false, APP_VERSION).unwrap_err();
        assert!(err.contains("synthdefs"), "unexpected: {err}");
    }

    #[test]
    fn pack_refuses_existing_output_unless_overwrite() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);
        pack_project(&project, false, APP_VERSION).unwrap();
        let err = pack_project(&project, false, APP_VERSION).unwrap_err();
        assert!(err.contains("already exists"), "unexpected: {err}");
        pack_project(&project, true, APP_VERSION).unwrap();
    }

    #[test]
    fn pack_leaves_source_tree_untouched() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);

        fn tree_snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
            let mut snapshot = BTreeMap::new();
            fn walk(dir: &Path, snapshot: &mut BTreeMap<PathBuf, Vec<u8>>) {
                for entry in fs::read_dir(dir).unwrap() {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        walk(&path, snapshot);
                    } else {
                        snapshot.insert(path.clone(), fs::read(&path).expect("readable file"));
                    }
                }
            }
            walk(root, &mut snapshot);
            snapshot
        }

        let before = tree_snapshot(&project);
        pack_project(&project, false, APP_VERSION).unwrap();
        let after = tree_snapshot(&project);
        assert_eq!(
            before.keys().collect::<Vec<_>>(),
            after.keys().collect::<Vec<_>>()
        );
        for (path, content) in &before {
            assert_eq!(&after[path], content, "changed: {}", path.display());
        }
    }

    /// in-root symlinks are materialized (with their permission
    /// bits — node_modules/.bin shims depend on them), out-of-root ones are
    /// skipped, and a directory symlink must not break the pack.
    #[cfg(unix)]
    #[test]
    fn pack_materializes_in_root_symlinks_and_skips_out_of_root() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project);

        // Executable in-root file symlink → materialized with the exec bit.
        let real_tool = project.join("node_modules/real-tool.js");
        fs::write(&real_tool, "#!/usr/bin/env node\n").unwrap();
        fs::set_permissions(&real_tool, fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink(
            project.join("node_modules/real-tool.js"),
            project.join("node_modules/.bin-tool"),
        )
        .unwrap();

        // In-root directory symlink → materialized as a real directory.
        std::os::unix::fs::symlink(project.join("public"), project.join("public-alias")).unwrap();

        // Out-of-root symlink → skipped silently.
        std::os::unix::fs::symlink("/usr/bin/true", project.join("external-link")).unwrap();

        let result = pack_project(&project, false, APP_VERSION).unwrap();
        let output = PathBuf::from(&result.output_path);

        let bundles = parent.path().join("bundles");
        let installed = install_bundle(&bundles, &output).unwrap();
        let mode = fs::metadata(installed.join("node_modules/.bin-tool"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755, "materialized symlink keeps exec bit");
        assert!(installed.join("public-alias/docs/guide.html").is_file());
        assert!(!installed.join("external-link").exists());
        // The real target still ships next to the materialized link.
        assert!(installed.join("node_modules/real-tool.js").is_file());
    }

    #[test]
    fn pack_sha256_matches_recomputed_digest() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        let result =
            pack_project(&parent.path().join("Inarticulate III"), true, APP_VERSION).unwrap();
        assert_eq!(result.sha256, sha256_hex(&output).unwrap());
        assert_eq!(result.sha256.len(), 64);
    }

    #[cfg(unix)]
    #[test]
    fn pack_preserves_executable_bits_through_install() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        use std::os::unix::fs::PermissionsExt;
        let script = parent
            .path()
            .join("Inarticulate III/node_modules/.bin/tool");
        fs::create_dir_all(script.parent().unwrap()).unwrap();
        fs::write(&script, "#!/bin/sh\necho hi\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        pack_project(&parent.path().join("Inarticulate III"), true, APP_VERSION).unwrap();
        assert!(zip_entry_names(&output)
            .iter()
            .any(|n| n == "Inarticulate III/node_modules/.bin/tool"));

        let bundles = parent.path().join("bundles");
        let installed = install_bundle(&bundles, &output).unwrap();
        let mode = fs::metadata(installed.join("node_modules/.bin/tool"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
    }

    #[test]
    fn install_extracts_into_bundles_id_version_dir() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        let bundles = parent.path().join("bundles");
        let installed = install_bundle(&bundles, &output).unwrap();
        assert_eq!(
            installed,
            bundles.join("inarticulate-iii-0.1.0"),
            "install dir name is <id>-<version>"
        );
        assert!(installed.join("manifest.json").is_file());
        assert!(installed.join("server.js").is_file());
        assert!(installed.join("node_modules/ws/index.js").is_file());
        assert!(!installed.join("docs").exists());
        crate::project::manifest::load_manifest(&installed).unwrap();
    }

    #[test]
    fn install_same_id_version_always_reinstalls() {
        let parent = tempfile::tempdir().unwrap();
        let output = pack_fixture(parent.path());
        let bundles = parent.path().join("bundles");
        let installed = install_bundle(&bundles, &output).unwrap();

        // Simulate a stale/modified install, then reinstall the same bundle.
        fs::write(installed.join("server.js"), "// stale").unwrap();
        fs::write(installed.join("leftover.txt"), "stale").unwrap();
        install_bundle(&bundles, &output).unwrap();
        assert_eq!(
            fs::read_to_string(installed.join("server.js")).unwrap(),
            "// score server"
        );
        assert!(
            !installed.join("leftover.txt").exists(),
            "old dir must be deleted, not merged"
        );
    }

    /// Standard zip writers emit explicit `<root>/` directory entries; the
    /// App's own packer does not. Both must install identically.
    #[test]
    fn install_accepts_explicit_directory_entries() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("standard.pnds");
        handcraft_zip(
            &bundle,
            &[
                (METADATA_ENTRY, &valid_metadata_json(), false),
                ("p/", "", false),
                ("p/manifest.json", &valid_project_manifest_json(), false),
                ("p/s.js", "// score server", false),
                ("p/sub/", "", false),
                ("p/sub/asset.txt", "data", false),
            ],
        );
        let bundles = parent.path().join("bundles");
        let installed = install_bundle(&bundles, &bundle).unwrap();
        assert!(installed.join("s.js").is_file());
        assert!(installed.join("sub/asset.txt").is_file());
    }

    /// Hand-builds a minimal zip so malformed bundles can be tested without
    /// going through the packer. `symlink = true` entries are written as zip
    /// symlink entries, and entries whose name ends with `/` as explicit
    /// directory entries (what standard zip writers emit).
    fn handcraft_zip(path: &Path, entries: &[(&str, &str, bool)]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        for (name, body, symlink) in entries {
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            if *symlink {
                writer.add_symlink(*name, body, options).unwrap();
            } else if name.ends_with('/') {
                writer
                    .add_directory(name.trim_end_matches('/'), options)
                    .unwrap();
            } else {
                writer.start_file(*name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
        }
        writer.finish().unwrap();
    }

    /// A minimal valid manifest for handcrafted bundles (external/none
    /// modes avoid needing synthdef artifacts on disk).
    fn valid_project_manifest_json() -> String {
        r#"{ "schemaVersion": 1, "id": "p", "name": "P", "version": "1.0.0",
            "scoreServer": { "entry": "s.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2 },
            "audio": { "defaultMode": "none", "supportedModes": ["none"] } }"#
            .to_string()
    }

    fn valid_metadata_json() -> String {
        serde_json::json!({
            "formatVersion": 1,
            "packedWith": "1.2.0",
            "packedAt": "2026-08-17T00:00:00Z",
            "sourcePlatform": "macos-aarch64"
        })
        .to_string()
    }

    #[test]
    fn install_rejects_missing_metadata_entry() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        handcraft_zip(&bundle, &[("p/manifest.json", "{}", false)]);
        let err = install_bundle(&parent.path().join("bundles"), &bundle).unwrap_err();
        assert!(err.contains("pnds-bundle.json"), "unexpected: {err}");
    }

    #[test]
    fn install_rejects_unsupported_format_version() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        let older = serde_json::json!({
            "formatVersion": 99,
            "packedWith": "x",
            "packedAt": "t",
            "sourcePlatform": "p"
        })
        .to_string();
        handcraft_zip(&bundle, &[(METADATA_ENTRY, &older, false)]);
        let err = install_bundle(&parent.path().join("bundles"), &bundle).unwrap_err();
        assert!(err.contains("formatVersion"), "unexpected: {err}");
    }

    #[test]
    fn install_rejects_traversal_entry() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        handcraft_zip(
            &bundle,
            &[
                (METADATA_ENTRY, &valid_metadata_json(), false),
                ("p/manifest.json", &valid_project_manifest_json(), false),
                ("p/../../evil.txt", "boom", false),
            ],
        );
        let bundles = parent.path().join("bundles");
        let err = install_bundle(&bundles, &bundle).unwrap_err();
        assert!(err.contains("unsafe"), "unexpected: {err}");
        assert!(!parent.path().join("evil.txt").exists());
    }

    #[test]
    fn install_rejects_symlink_entry() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        let manifest = valid_project_manifest_json();
        handcraft_zip(
            &bundle,
            &[
                (METADATA_ENTRY, &valid_metadata_json(), false),
                ("p/manifest.json", &manifest, false),
                ("p/link", "/etc/passwd", true),
            ],
        );
        let err = install_bundle(&parent.path().join("bundles"), &bundle).unwrap_err();
        assert!(err.contains("symbolic link"), "unexpected: {err}");
    }

    #[test]
    fn install_rejects_multiple_roots_and_missing_manifest() {
        let parent = tempfile::tempdir().unwrap();
        let meta = valid_metadata_json();
        let manifest = r#"{ "schemaVersion": 1, "id": "p", "name": "P", "version": "1.0.0",
            "scoreServer": { "entry": "s.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2 },
            "audio": { "defaultMode": "none", "supportedModes": ["none"] } }"#;

        let two_roots = parent.path().join("two.pnds");
        handcraft_zip(
            &two_roots,
            &[
                (METADATA_ENTRY, &meta, false),
                ("p/manifest.json", manifest, false),
                ("q/manifest.json", manifest, false),
            ],
        );
        let err = install_bundle(&parent.path().join("bundles"), &two_roots).unwrap_err();
        assert!(err.contains("exactly one"), "unexpected: {err}");

        let no_manifest = parent.path().join("nomanifest.pnds");
        handcraft_zip(
            &no_manifest,
            &[(METADATA_ENTRY, &meta, false), ("p/readme.txt", "x", false)],
        );
        let err = install_bundle(&parent.path().join("bundles"), &no_manifest).unwrap_err();
        assert!(err.contains("manifest.json"), "unexpected: {err}");
    }

    #[test]
    fn install_rejects_path_separator_in_manifest_id() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        handcraft_zip(
            &bundle,
            &[
                (METADATA_ENTRY, &valid_metadata_json(), false),
                (
                    "p/manifest.json",
                    &r#"{ "schemaVersion": 1, "id": "a/b", "name": "P", "version": "1.0.0",
                        "scoreServer": { "entry": "s.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2 },
                        "audio": { "defaultMode": "none", "supportedModes": ["none"] } }"#
                        .to_string(),
                    false,
                ),
            ],
        );
        let err = install_bundle(&parent.path().join("bundles"), &bundle).unwrap_err();
        assert!(err.contains("single path segment"), "unexpected: {err}");
    }

    #[test]
    fn install_rejects_invalid_manifest_after_extraction() {
        let parent = tempfile::tempdir().unwrap();
        let bundle = parent.path().join("bad.pnds");
        handcraft_zip(
            &bundle,
            &[
                (METADATA_ENTRY, &valid_metadata_json(), false),
                (
                    "p/manifest.json",
                    &r#"{ "schemaVersion": 1, "id": "p", "name": "P", "version": "1.0.0",
                        "scoreServer": { "entry": "missing.js", "workingDirectory": ".", "performerPort": 1, "monitorPort": 2 },
                        "audio": { "defaultMode": "none", "supportedModes": ["none"] } }"#
                        .to_string(),
                    false,
                ),
            ],
        );
        let err = install_bundle(&parent.path().join("bundles"), &bundle).unwrap_err();
        assert!(err.contains("scoreServer.entry"), "unexpected: {err}");
        // a failed install must not leave a half-extracted directory.
        assert!(!parent.path().join("bundles/p-1.0.0").exists());
    }

    #[test]
    fn reclaim_deletes_managed_install_and_ignores_everything_else() {
        let parent = tempfile::tempdir().unwrap();
        let bundles = parent.path().join("bundles");
        let installed = bundles.join("demo-1.0.0");
        fs::create_dir_all(&installed).unwrap();
        fs::create_dir_all(bundles.join("nested/inner")).unwrap();
        let user_project = parent.path().join("My Project");
        fs::create_dir_all(&user_project).unwrap();

        // Direct child of bundles/ → reclaimed.
        assert!(reclaim_bundle_dir(&bundles, &installed).unwrap());
        assert!(!installed.exists());

        // Deeper path (not a direct child) → untouched.
        assert!(!reclaim_bundle_dir(&bundles, &bundles.join("nested/inner")).unwrap());
        assert!(bundles.join("nested/inner").exists());

        // Path outside bundles/ → untouched, even though it exists.
        assert!(!reclaim_bundle_dir(&bundles, &user_project).unwrap());
        assert!(user_project.exists());

        // Already-gone path → idempotent no-op.
        assert!(!reclaim_bundle_dir(&bundles, &installed).unwrap());
    }

    #[test]
    fn sanitize_name_component_replaces_hostile_characters() {
        assert_eq!(
            sanitize_name_component("a/b\\c:d*e?f\"g<h>i|j"),
            "a-b-c-d-e-f-g-h-i-j"
        );
        assert_eq!(sanitize_name_component("  ..Trailing.. "), "Trailing");
        assert_eq!(sanitize_name_component(""), "");
    }

    #[test]
    fn rfc3339_timestamps_are_well_formed() {
        let stamp = rfc3339_utc_now();
        // e.g. 2026-08-17T09:30:00Z — structural assertions only (no clock
        // dependency beyond "now parses as the expected shape").
        assert_eq!(stamp.len(), 20);
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], "T");
        assert!(stamp.ends_with('Z'));
        assert!(stamp.starts_with("20"));
    }

    #[test]
    fn output_path_uses_sanitized_name_and_rejects_bad_versions() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("P");
        fs::create_dir_all(&project).unwrap();
        let manifest = crate::project::manifest::Manifest {
            schema_version: 1,
            id: "some-id".into(),
            name: "Weird / Name".into(),
            version: "1.0.0".into(),
            description: None,
            score_server: crate::project::manifest::ScoreServer {
                entry: "s.js".into(),
                working_directory: ".".into(),
                performer_port: 1,
                monitor_port: 2,
            },
            audio: crate::project::manifest::AudioConfig {
                default_mode: "none".into(),
                supported_modes: vec!["none".into()],
                output_channels: 2,
                synthdefs: None,
                scsynth: None,
                standalone_target: None,
            },
        };
        let path = bundle_output_path(&project, &manifest).unwrap();
        assert!(path.ends_with("Weird - Name-1.0.0.pnds"), "{path:?}");

        let mut bad = manifest.clone();
        bad.version = "../evil".into();
        let err = bundle_output_path(&project, &bad).unwrap_err();
        assert!(err.contains("single path segment"), "unexpected: {err}");
    }
}
