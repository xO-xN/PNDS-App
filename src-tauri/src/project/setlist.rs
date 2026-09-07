//! PNDS setlist export service (v1.4.0, issues #59 + #63, spec #57).
//!
//! An export directory is a wholly-copyable handover unit: each member
//! project's `.pnds` (packer name `<sanitized name>-<version>.pnds`), a
//! `set.json` describing the set, and an import instructions `README.txt`.
//! The set.json body itself is assembled and serialized by the frontend
//! (`src/lib/setlist.ts` pins the schema — the field set is a UI concern,
//! and hand-editability is the format's point); this module owns the
//! on-disk work: the packability gate, the per-project describe the
//! frontend assembles from, packing into the chosen directory, the two
//! text files, and — for the import (#63) — reading a directory back:
//! the raw set.json body plus the identity probe of every `.pnds` beside
//! it.
//!
//! All functions here are path-based (no AppHandle) so the export and
//! import flows are testable with tempdir fixtures, like `bundle.rs`.

use serde::Serialize;
use specta::Type;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::project::bundle;

/// The setlist's manifest file inside an export directory.
pub const SETLIST_FILE_NAME: &str = "set.json";

/// The import instructions file beside it (composed by the frontend so it
/// localizes in the exporting machine's language).
pub const SETLIST_README_FILE_NAME: &str = "README.txt";

/// v1.4.0 (#59): what the frontend needs to assemble one set.json entry —
/// the manifest identity plus the `.pnds` file name the export will
/// produce. `path` rides along so the caller pairs infos with its request
/// order explicitly.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetlistProjectInfo {
    pub path: String,
    pub id: String,
    pub version: String,
    /// The manifest's declared default audio mode.
    pub default_audio_mode: crate::types::AudioMode,
    /// The `<sanitized name>-<version>.pnds` artifact this export writes.
    pub file_name: String,
}

/// v1.4.0 (#59): the finished export's location (Finder reveal target).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetlistExportResult {
    pub output_dir: String,
}

/// v1.4.0 (#63): one `.pnds` found in an export directory, with the
/// identity the import matches entries on.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetlistBundleFile {
    pub path: String,
    pub file_name: String,
    pub id: String,
    pub version: String,
}

/// v1.4.0 (#63): what the import reads out of an export directory — the
/// raw set.json body (the frontend's `parseSetlist` is the validation
/// seam; this side only proves the file exists and reads) plus every
/// `.pnds` beside it with its probed identity.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetlistReadout {
    pub setlist_json: String,
    pub bundles: Vec<SetlistBundleFile>,
}

/// The export pre-flight: every path through the same packability gate a
/// pack would run (full manifest validation, dependency check), plus the
/// identity and derived file name the frontend needs for set.json. The
/// first failing path aborts with its name in the error — nothing has
/// been written yet.
pub fn describe_projects(project_paths: &[String]) -> Result<Vec<SetlistProjectInfo>, String> {
    if project_paths.is_empty() {
        return Err("The export holds no projects".to_string());
    }
    let mut infos = Vec::with_capacity(project_paths.len());
    for path in project_paths {
        let (manifest, output) =
            bundle::validate_packable(&PathBuf::from(path)).map_err(|e| format!("{path}: {e}"))?;
        let file_name = output_file_name(&output)?;
        infos.push(SetlistProjectInfo {
            path: path.clone(),
            id: manifest.id,
            version: manifest.version,
            default_audio_mode: manifest.audio.default_mode,
            file_name,
        });
    }
    Ok(infos)
}

/// Writes the export into `dest_dir`: every project packed (in list order)
/// into its `<name>-<version>.pnds`, then the frontend-serialized
/// `set.json` and the instructions `README.txt` beside them. An existing
/// same-named artifact is replaced — a re-export owns its directory's
/// artifacts. On any failure every file this run wrote is removed again,
/// so a failed export never leaves a directory that reads as complete.
///
/// `progress` runs before each pack with the project's 0-based index, the
/// total and the artifact file name (v1.4.0, user report after #59: the
/// UI shows per-project progress — packing a full setlist takes a while).
pub fn export_setlist(
    dest_dir: &Path,
    project_paths: &[String],
    setlist_json: &str,
    instructions: &str,
    packed_with: &str,
    progress: &dyn Fn(usize, usize, &str),
) -> Result<SetlistExportResult, String> {
    if project_paths.is_empty() {
        return Err("The export holds no projects".to_string());
    }
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create {}: {e}", dest_dir.display()))?;

    let mut written: Vec<PathBuf> = Vec::new();
    let outcome = (|| -> Result<(), String> {
        for (index, path) in project_paths.iter().enumerate() {
            let (_, output) = bundle::validate_packable(&PathBuf::from(path))
                .map_err(|e| format!("{path}: {e}"))?;
            let file_name = output_file_name(&output)?;
            progress(index, project_paths.len(), &file_name);
            let target = dest_dir.join(&file_name);
            bundle::pack_project_to(&PathBuf::from(path), &target, packed_with)?;
            written.push(target);
        }
        // The text files land last: set.json reaching the disk means every
        // artifact it describes is already there.
        let setlist_path = dest_dir.join(SETLIST_FILE_NAME);
        write_text_atomically(&setlist_path, setlist_json)?;
        written.push(setlist_path);
        let readme_path = dest_dir.join(SETLIST_README_FILE_NAME);
        write_text_atomically(&readme_path, instructions)?;
        written.push(readme_path);
        Ok(())
    })();

    match outcome {
        Ok(()) => Ok(SetlistExportResult {
            output_dir: dest_dir.to_string_lossy().into_owned(),
        }),
        Err(error) => {
            for path in &written {
                let _ = fs::remove_file(path);
            }
            Err(error)
        }
    }
}

/// The file name half of `bundle_output_path` — the one derivation shared
/// by describe and export so a set.json `file` hint always matches the
/// artifact the export actually writes.
fn output_file_name(output: &Path) -> Result<String, String> {
    output
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("No file name in {}", output.display()))
}

// ─────────────────────────── reading (#63) ───────────────────────────

/// v1.4.0 (#63): reads an export directory for the import. The raw
/// set.json body comes back untouched (the frontend's `parseSetlist`
/// validates); every `.pnds` beside it is probed for its manifest
/// identity, in file-name order so duplicate identities resolve
/// deterministically. Directories without a `set.json` are an error —
/// the routing seam reads exactly that as "not a setlist export".
pub fn read_setlist(dir: &Path) -> Result<SetlistReadout, String> {
    let setlist_path = dir.join(SETLIST_FILE_NAME);
    if !setlist_path.is_file() {
        return Err(format!("No {SETLIST_FILE_NAME} in {}", dir.display()));
    }
    let setlist_json = fs::read_to_string(&setlist_path)
        .map_err(|e| format!("Failed to read {}: {e}", setlist_path.display()))?;

    let mut names: Vec<String> = Vec::new();
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() && name.to_lowercase().ends_with(".pnds") {
            names.push(name);
        }
    }
    names.sort();

    let mut bundles = Vec::with_capacity(names.len());
    for name in &names {
        let path = dir.join(name);
        // A lenient probe: an unreadable archive is skipped, not fatal —
        // the install (the real gate) reports the readable error for a
        // bundle the set actually claims.
        if let Some((id, version)) = probe_bundle_identity(&path) {
            bundles.push(SetlistBundleFile {
                path: path.to_string_lossy().into_owned(),
                file_name: name.clone(),
                id,
                version,
            });
        }
    }
    Ok(SetlistReadout {
        setlist_json,
        bundles,
    })
}

/// The single-root-zip identity probe: a bundle whose one root directory
/// holds a readable `manifest.json` yields its `id` + `version`. Anything
/// else reads as `None` — this is matching data, not validation; the
/// install step remains the gate.
fn probe_bundle_identity(path: &Path) -> Option<(String, String)> {
    let file = File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let root = single_root_name(&mut archive)?;
    let mut entry = archive.by_name(&format!("{root}/manifest.json")).ok()?;
    let mut body = String::new();
    entry.read_to_string(&mut body).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&body).ok()?;
    let id = manifest.get("id")?.as_str()?.to_string();
    let version = manifest.get("version")?.as_str()?.to_string();
    Some((id, version))
}

/// The one top-level directory every entry lives under, or `None` for
/// anything else (multiple roots, stray top-level files). Standard zip
/// writers emit explicit `<root>/` directory entries; those count as the
/// root, not as strays.
fn single_root_name(archive: &mut zip::ZipArchive<File>) -> Option<String> {
    let mut roots: Vec<String> = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).ok()?;
        let is_dir_entry = entry.name().ends_with('/');
        let name = entry.name().trim_end_matches('/');
        let mut components = Path::new(name).components();
        let Some(top) = components.next() else {
            continue;
        };
        let top = top.as_os_str().to_string_lossy().into_owned();
        let deeper = components.next().is_some();
        if !deeper && !is_dir_entry {
            // Only the metadata entry may sit at the top level — and it is
            // not a root.
            if name == bundle::METADATA_ENTRY {
                continue;
            }
            return None; // a stray top-level file — not our layout
        }
        if !roots.contains(&top) {
            roots.push(top);
        }
    }
    if roots.len() == 1 {
        roots.pop()
    } else {
        None
    }
}

/// Writes `contents` to `path` through a `.part` sibling + rename, the
/// same atomicity idiom the packer uses for its archives.
fn write_text_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_file_name(format!(
        ".{}.part",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
    ));
    let write = File::create(&tmp)
        .and_then(|mut file| file.write_all(contents.as_bytes()))
        .map_err(|e| format!("Failed to write {}: {e}", path.display()));
    match write {
        Ok(()) => fs::rename(&tmp, path)
            .map_err(|e| format!("Failed to finalize {}: {e}", path.display())),
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const APP_VERSION: &str = "1.4.0-test";

    /// A minimal packable project (the bundle tests' fixture shape) with
    /// parameterized identity and audio mode. `internal` mode demands a
    /// synthdef artifact, so the fixture declares one only for it.
    fn fixture_project(dir: &Path, id: &str, name: &str, version: &str, mode: &str) {
        fs::create_dir_all(dir.join("node_modules/ws")).unwrap();
        fs::write(dir.join("server.js"), "// score server").unwrap();
        fs::write(dir.join("node_modules/ws/index.js"), "// ws").unwrap();
        fs::write(
            dir.join("package.json"),
            r#"{ "dependencies": { "ws": "^8.0.0" } }"#,
        )
        .unwrap();
        let synthdefs = if mode == "internal" {
            fs::create_dir_all(dir.join("supercollider/synthdefs")).unwrap();
            fs::write(dir.join("supercollider/synthdefs/p.scsyndef"), b"SCgf").unwrap();
            let path = "supercollider/synthdefs/p.scsyndef";
            format!(
                ", \"synthdefs\": [\"{path}\"], \"scsynth\": {{ \"sampleRate\": 48000, \"blockSize\": 64, \"audioBusChannels\": 128 }}"
            )
        } else {
            String::new()
        };
        fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{
                  "schemaVersion": 1,
                  "id": "{id}",
                  "name": "{name}",
                  "version": "{version}",
                  "scoreServer": {{ "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }},
                  "audio": {{ "defaultMode": "{mode}", "supportedModes": ["{mode}"]{synthdefs} }}
                }}"#
            ),
        )
        .unwrap();
    }

    fn describe(path: &str) -> SetlistProjectInfo {
        let infos = describe_projects(&[path.to_string()]).unwrap();
        infos.into_iter().next().unwrap()
    }

    #[test]
    fn describe_reports_identity_mode_and_derived_file_name() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("Proj A");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project, "proj-a", "Proj A", "1.2.0", "external");

        let info = describe(&project.to_string_lossy());
        assert_eq!(info.path, project.to_string_lossy());
        assert_eq!(info.id, "proj-a");
        assert_eq!(info.version, "1.2.0");
        assert_eq!(info.default_audio_mode, crate::types::AudioMode::External);
        assert_eq!(info.file_name, "Proj A-1.2.0.pnds");
    }

    #[test]
    fn describe_refuses_empty_and_unpackable_projects() {
        let err = describe_projects(&[]).unwrap_err();
        assert!(err.contains("no projects"), "unexpected: {err}");

        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("Broken");
        fs::create_dir_all(&project).unwrap();
        // No manifest at all — the error must name the project path.
        let err = describe_projects(&[project.to_string_lossy().into_owned()]).unwrap_err();
        assert!(
            err.contains("Broken") && err.contains("manifest"),
            "unexpected: {err}"
        );
    }

    /// v1.4.0 (user report after #59): one progress step per project, in
    /// list order, naming the artifact about to be packed — and a failed
    /// export stops announcing at the failure.
    #[test]
    fn export_reports_progress_per_project_and_stops_on_failure() {
        let parent = tempfile::tempdir().unwrap();
        let good = parent.path().join("Good");
        let other = parent.path().join("Other");
        let broken = parent.path().join("Broken");
        for dir in [&good, &other, &broken] {
            fs::create_dir_all(dir).unwrap();
        }
        fixture_project(&good, "good", "Good", "1.0.0", "external");
        fixture_project(&other, "other", "Other", "2.0.0", "external");
        fixture_project(&broken, "broken", "Broken", "3.0.0", "external");
        fs::remove_dir_all(broken.join("node_modules")).unwrap();

        let dest = parent.path().join("Export");
        type Steps = std::sync::Arc<std::sync::Mutex<Vec<(usize, usize, String)>>>;
        let recorder = |steps: Steps| {
            move |done: usize, total: usize, name: &str| {
                steps.lock().unwrap().push((done, total, name.to_string()));
            }
        };

        let ok_steps: Steps = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        export_setlist(
            &dest,
            &[
                good.to_string_lossy().into_owned(),
                other.to_string_lossy().into_owned(),
            ],
            "{\"formatVersion\":1}\n",
            "readme\n",
            APP_VERSION,
            &recorder(ok_steps.clone()),
        )
        .unwrap();
        assert_eq!(
            ok_steps.lock().unwrap().as_slice(),
            &[
                (0, 2, "Good-1.0.0.pnds".to_string()),
                (1, 2, "Other-2.0.0.pnds".to_string()),
            ]
        );

        // The broken third project fails its packability gate — the
        // announcement list ends before it.
        let fail_steps: Steps = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let err = export_setlist(
            &dest,
            &[
                good.to_string_lossy().into_owned(),
                broken.to_string_lossy().into_owned(),
            ],
            "{\"formatVersion\":1}\n",
            "readme\n",
            APP_VERSION,
            &recorder(fail_steps.clone()),
        )
        .unwrap_err();
        assert!(err.contains("Broken"), "unexpected: {err}");
        assert_eq!(
            fail_steps.lock().unwrap().as_slice(),
            &[(0, 2, "Good-1.0.0.pnds".to_string())]
        );
    }

    #[test]
    fn export_writes_pnds_setlist_and_readme_in_the_directory() {
        let parent = tempfile::tempdir().unwrap();
        let first = parent.path().join("First");
        let second = parent.path().join("Second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fixture_project(&first, "first", "First", "1.0.0", "internal");
        fixture_project(&second, "second", "Second", "2.0.0", "external");

        let dest = parent.path().join("Export");
        let setlist_json = "{\n  \"formatVersion\": 1\n}\n";
        let instructions = "import me\n";
        let result = export_setlist(
            &dest,
            &[
                second.to_string_lossy().into_owned(),
                first.to_string_lossy().into_owned(),
            ],
            setlist_json,
            instructions,
            APP_VERSION,
            &|_, _, _| {},
        )
        .unwrap();

        assert_eq!(result.output_dir, dest.to_string_lossy());
        // Every artifact the format pins is present, byte-exact for the
        // text files.
        assert_eq!(
            fs::read_to_string(dest.join(SETLIST_FILE_NAME)).unwrap(),
            setlist_json
        );
        assert_eq!(
            fs::read_to_string(dest.join(SETLIST_README_FILE_NAME)).unwrap(),
            instructions
        );
        for file in ["First-1.0.0.pnds", "Second-2.0.0.pnds"] {
            assert!(dest.join(file).is_file(), "missing {file}");
        }
        // The packed bundles are real installable .pnds archives.
        let bundles = parent.path().join("bundles");
        let installed = bundle::install_bundle(&bundles, &dest.join("First-1.0.0.pnds")).unwrap();
        assert!(installed.join("manifest.json").is_file());
    }

    #[test]
    fn export_replaces_a_previous_run_same_named_artifacts() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project, "p", "P", "1.0.0", "internal");

        let dest = parent.path().join("Export");
        let run = |setlist_json: &str| {
            export_setlist(
                &dest,
                &[project.to_string_lossy().into_owned()],
                setlist_json,
                "readme\n",
                APP_VERSION,
                &|_, _, _| {},
            )
            .unwrap()
        };
        run("{\"formatVersion\":1,\"name\":\"first\"}\n");
        // A second run into the same directory (idempotent re-export)
        // replaces its own artifacts with the new content.
        run("{\"formatVersion\":1,\"name\":\"second\"}\n");
        assert!(dest.join("P-1.0.0.pnds").is_file());
        assert_eq!(
            fs::read_to_string(dest.join(SETLIST_FILE_NAME)).unwrap(),
            "{\"formatVersion\":1,\"name\":\"second\"}\n"
        );
    }

    #[test]
    fn export_failure_cleans_up_this_run_artifacts() {
        let parent = tempfile::tempdir().unwrap();
        let good = parent.path().join("Good");
        let broken = parent.path().join("Broken");
        fs::create_dir_all(&good).unwrap();
        fs::create_dir_all(&broken).unwrap();
        fixture_project(&good, "good", "Good", "1.0.0", "internal");
        // The broken project packs nothing — missing node_modules fails
        // the dependency gate.
        fixture_project(&broken, "broken", "Broken", "2.0.0", "internal");
        fs::remove_dir_all(broken.join("node_modules")).unwrap();

        let dest = parent.path().join("Export");
        let err = export_setlist(
            &dest,
            &[
                good.to_string_lossy().into_owned(),
                broken.to_string_lossy().into_owned(),
            ],
            "{\"formatVersion\":1}\n",
            "readme\n",
            APP_VERSION,
            &|_, _, _| {},
        )
        .unwrap_err();
        assert!(err.contains("Broken"), "unexpected: {err}");

        // The first project packed fine, but a failed export leaves no
        // directory that reads as complete.
        assert!(!dest.join("Good-1.0.0.pnds").exists());
        assert!(!dest.join(SETLIST_FILE_NAME).exists());
        assert!(!dest.join(SETLIST_README_FILE_NAME).exists());
    }

    #[test]
    fn read_returns_the_setlist_body_and_bundle_identities() {
        let parent = tempfile::tempdir().unwrap();
        let first = parent.path().join("First");
        let second = parent.path().join("Second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fixture_project(&first, "first", "First", "1.0.0", "internal");
        fixture_project(&second, "second", "Second", "2.0.0", "external");

        let dest = parent.path().join("Export");
        let setlist_json = "{\"formatVersion\":1,\"name\":\"Gig\"}\n";
        export_setlist(
            &dest,
            &[
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            setlist_json,
            "readme\n",
            APP_VERSION,
            &|_, _, _| {},
        )
        .unwrap();

        let readout = read_setlist(&dest).unwrap();
        // The body comes back byte-exact — validation is the frontend's
        // parse seam, this side only proves it reads.
        assert_eq!(readout.setlist_json, setlist_json);
        assert_eq!(readout.bundles.len(), 2);
        assert_eq!(readout.bundles[0].file_name, "First-1.0.0.pnds");
        assert_eq!(readout.bundles[0].id, "first");
        assert_eq!(readout.bundles[0].version, "1.0.0");
        assert_eq!(
            readout.bundles[0].path,
            dest.join("First-1.0.0.pnds").to_string_lossy()
        );
        assert_eq!(readout.bundles[1].id, "second");
        assert_eq!(readout.bundles[1].version, "2.0.0");
    }

    #[test]
    fn read_refuses_directories_without_set_json() {
        let parent = tempfile::tempdir().unwrap();
        let plain = parent.path().join("Plain");
        fs::create_dir_all(&plain).unwrap();
        let err = read_setlist(&plain).unwrap_err();
        assert!(err.contains("set.json"), "unexpected: {err}");
        // A plain project directory reads the same way — the routing seam
        // falls through to the normal open flow on this error.
        let project = parent.path().join("Proj");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project, "proj", "Proj", "1.0.0", "external");
        assert!(read_setlist(&project).is_err());
    }

    #[test]
    fn read_skips_unreadable_archives_and_ignores_other_files() {
        let parent = tempfile::tempdir().unwrap();
        let project = parent.path().join("P");
        fs::create_dir_all(&project).unwrap();
        fixture_project(&project, "p", "P", "1.0.0", "external");
        let dest = parent.path().join("Export");
        export_setlist(
            &dest,
            &[project.to_string_lossy().into_owned()],
            "{\"formatVersion\":1}\n",
            "readme\n",
            APP_VERSION,
            &|_, _, _| {},
        )
        .unwrap();

        // A corrupt .pnds beside the real one is skipped (the install
        // reports the readable error for a bundle the set claims); other
        // files never enter the scan.
        fs::write(dest.join("Broken-9.9.9.pnds"), b"not a zip").unwrap();
        fs::write(dest.join("notes.txt"), b"operator notes").unwrap();

        let readout = read_setlist(&dest).unwrap();
        assert_eq!(readout.bundles.len(), 1);
        assert_eq!(readout.bundles[0].id, "p");
    }
}
