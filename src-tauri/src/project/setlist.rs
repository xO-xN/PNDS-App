//! PNDS setlist export service (v1.4.0, issue #59, spec #57).
//!
//! An export directory is a wholly-copyable handover unit: each member
//! project's `.pnds` (packer name `<sanitized name>-<version>.pnds`), a
//! `set.json` describing the set, and an import instructions `README.txt`.
//! The set.json body itself is assembled and serialized by the frontend
//! (`src/lib/setlist.ts` pins the schema — the field set is a UI concern,
//! and hand-editability is the format's point); this module owns the
//! on-disk work: the packability gate, the per-project describe the
//! frontend assembles from, packing into the chosen directory, and the
//! two text files.
//!
//! All functions here are path-based (no AppHandle) so the export flows
//! are testable with tempdir fixtures, like `bundle.rs`.

use serde::Serialize;
use specta::Type;
use std::fs::{self, File};
use std::io::Write;
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
    pub default_audio_mode: String,
    /// The `<sanitized name>-<version>.pnds` artifact this export writes.
    pub file_name: String,
}

/// v1.4.0 (#59): the finished export's location (Finder reveal target).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetlistExportResult {
    pub output_dir: String,
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
pub fn export_setlist(
    dest_dir: &Path,
    project_paths: &[String],
    setlist_json: &str,
    instructions: &str,
    packed_with: &str,
) -> Result<SetlistExportResult, String> {
    if project_paths.is_empty() {
        return Err("The export holds no projects".to_string());
    }
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create {}: {e}", dest_dir.display()))?;

    let mut written: Vec<PathBuf> = Vec::new();
    let outcome = (|| -> Result<(), String> {
        for path in project_paths {
            let (_, output) = bundle::validate_packable(&PathBuf::from(path))
                .map_err(|e| format!("{path}: {e}"))?;
            let target = dest_dir.join(output_file_name(&output)?);
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
        assert_eq!(info.default_audio_mode, "external");
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
        )
        .unwrap_err();
        assert!(err.contains("Broken"), "unexpected: {err}");

        // The first project packed fine, but a failed export leaves no
        // directory that reads as complete.
        assert!(!dest.join("Good-1.0.0.pnds").exists());
        assert!(!dest.join(SETLIST_FILE_NAME).exists());
        assert!(!dest.join(SETLIST_README_FILE_NAME).exists());
    }
}
