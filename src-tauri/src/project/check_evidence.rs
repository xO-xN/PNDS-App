//! Saved-input evidence for isolated checks. Copies are sequential, never atomic.
use super::contained_read::ReadRoot;
use super::creation::{CreationAccess, GitReader, Protection};
use super::manifest::SharedLibraryReference;
use super::shared_libraries::{self, LibraryCatalog};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs::{self, Metadata};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_ENTRIES: usize = 100_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceFile {
    pub path: String,
    pub directory: bool,
    #[specta(type = f64)]
    pub bytes: u64,
    pub sha256: String,
    pub mode: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEvidence {
    pub name: String,
    pub declaration: String,
    pub optional: bool,
    pub installed_version: Option<String>,
    pub exact_shared_version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackageEvidence {
    pub path: String,
    pub name: Option<String>,
    pub version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitEvidence {
    pub head: Option<String>,
    pub dirty: Option<bool>,
    pub state: String,
    pub detail: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InputEvidence {
    pub source_root: String,
    pub source_identity: String,
    pub shared_source_root: Option<String>,
    pub project_sha256: String,
    pub shared_sha256: Option<String>,
    pub project_files: Vec<EvidenceFile>,
    pub shared_files: Vec<EvidenceFile>,
    pub production_dependencies: Vec<DependencyEvidence>,
    pub installed_packages: Vec<InstalledPackageEvidence>,
    pub shared_libraries: Vec<SharedLibraryReference>,
    pub git: GitEvidence,
    pub changed_during_preparation: bool,
    pub scope: String,
    pub notes: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Freshness {
    pub stale: bool,
    pub complete: bool,
    pub reasons: Vec<String>,
}
#[derive(Debug)]
pub struct PreparedSnapshot {
    pub project_root: PathBuf,
    pub shared_root: Option<PathBuf>,
    pub evidence: InputEvidence,
}

/// Destination is an existing empty temporary directory owned by this check.
/// On error/cancellation its owner removes any partially copied contents.
pub fn prepare_snapshot(
    source: &Path,
    shared_root: Option<&Path>,
    destination: &Path,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(&str, u64),
) -> Result<PreparedSnapshot, String> {
    check_cancelled(cancelled)?;
    let reader = ReadRoot::new(source)?;
    let destination = destination.canonicalize().map_err(message)?;
    if destination.starts_with(&reader.path) || reader.path.starts_with(&destination) {
        return Err("Snapshot destination must be separate from the source project".into());
    }
    if fs::read_dir(&destination)
        .map_err(message)?
        .next()
        .is_some()
    {
        return Err("Snapshot destination must be empty".into());
    }
    let project_root = destination.join("project");
    fs::create_dir(&project_root).map_err(message)?;
    let copied = scan(&reader, Some(&project_root), cancelled, &mut progress)?;
    let project_files = scan(
        &ReadRoot::new(&project_root)?,
        None,
        cancelled,
        &mut |_, _| {},
    )?;
    if copied != project_files {
        return Err("Saved snapshot content differs from copied input".into());
    }
    let mut notes = vec!["Git HEAD and dirty state are auxiliary observations made after copying, not the snapshot identity. Sequential saved-file copy; this is not an instantaneous atomic snapshot. Root .git is excluded; node_modules, lockfiles, assets and saved sources are included. Limits: 100000 entries, 2 GiB/file, 8 GiB/tree.".into()];
    let references = read_json(&project_root.join("manifest.json"))
        .and_then(|value| value.get("sharedLibraries").cloned())
        .map(serde_json::from_value::<Vec<SharedLibraryReference>>)
        .transpose()
        .map_err(|error| format!("Cannot capture shared library references: {error}"))?
        .unwrap_or_default();
    let (shared_root, shared_source_root, shared_files) = if references.is_empty() {
        (None, None, Vec::new())
    } else {
        let original = match shared_root {
            Some(path) => path.to_path_buf(),
            None => shared_libraries::default_root()?,
        };
        let shared_reader = ReadRoot::new(&original)?;
        let captured = destination.join("shared-libraries");
        if captured.starts_with(&shared_reader.path) || shared_reader.path.starts_with(&destination)
        {
            return Err("Snapshot destination must be separate from shared resources".into());
        }
        fs::create_dir(&captured).map_err(message)?;
        let copied = scan(&shared_reader, Some(&captured), cancelled, &mut progress)?;
        let files = scan(&ReadRoot::new(&captured)?, None, cancelled, &mut |_, _| {})?;
        if copied != files {
            return Err("Saved shared snapshot differs from copied input".into());
        }
        LibraryCatalog::load(&captured)?.resolve(&captured, &references)?;
        (
            Some(captured),
            Some(shared_reader.path.to_string_lossy().into_owned()),
            files,
        )
    };
    let production_dependencies = dependencies(&project_root, &references, &mut notes);
    let installed_packages = project_files
        .iter()
        .filter(|file| {
            !file.directory
                && file.path.starts_with("node_modules/")
                && file.path.ends_with("/package.json")
        })
        .map(|file| {
            let package = read_json(&project_root.join(&file.path));
            InstalledPackageEvidence {
                path: file.path.clone(),
                name: package
                    .as_ref()
                    .and_then(|value| value.get("name"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                version: package
                    .as_ref()
                    .and_then(|value| value.get("version"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            }
        })
        .collect();
    let mut evidence = InputEvidence {
        source_root: reader.path.to_string_lossy().into_owned(),
        source_identity: root_identity(&reader)?,
        shared_source_root,
        project_sha256: fingerprint(&project_files),
        shared_sha256: shared_root.as_ref().map(|_| fingerprint(&shared_files)),
        project_files,
        shared_files,
        production_dependencies,
        installed_packages,
        shared_libraries: references,
        git: git_evidence(&reader.path),
        changed_during_preparation: false,
        scope: "All regular saved project files and directories except root .git; all captured App shared resources when referenced. Directory symlinks and special files are rejected. Contained file symlinks are materialized as files.".into(),
        notes,
    };
    check_cancelled(cancelled)?;
    let fresh = source_freshness(
        source,
        evidence.shared_source_root.as_deref().map(Path::new),
        &evidence,
        cancelled,
    );
    check_cancelled(cancelled)?;
    evidence.changed_during_preparation = fresh.stale || !fresh.complete;
    evidence.notes.extend(fresh.reasons);
    Ok(PreparedSnapshot {
        project_root,
        shared_root,
        evidence,
    })
}

/// Rehash actual source content; watcher counters and Git HEAD are not freshness evidence.
pub fn source_freshness(
    source: &Path,
    shared_root: Option<&Path>,
    evidence: &InputEvidence,
    cancelled: &AtomicBool,
) -> Freshness {
    let mut result = Freshness {
        stale: evidence.changed_during_preparation,
        complete: true,
        reasons: Vec::new(),
    };
    if evidence.changed_during_preparation {
        result
            .reasons
            .push("Source changed or could not be completely reread during preparation".into());
    }
    let mut compare =
        |path: &Path, expected: &str, label: &str| match ReadRoot::new(path).and_then(|reader| {
            if label == "Project"
                && (reader.path.to_string_lossy() != evidence.source_root
                    || root_identity(&reader)? != evidence.source_identity)
            {
                return Err("Selected project root no longer matches captured source".into());
            }
            scan(&reader, None, cancelled, &mut |_, _| {})
        }) {
            Ok(files) if fingerprint(&files) == expected => {}
            Ok(_) => {
                result.stale = true;
                result
                    .reasons
                    .push(format!("{label} content differs from the captured input"));
            }
            Err(error) => {
                result.stale = true;
                result.complete = false;
                result.reasons.push(format!(
                    "{label} freshness could not be completely read: {error}"
                ));
            }
        };
    compare(source, &evidence.project_sha256, "Project");
    if let Some(expected) = &evidence.shared_sha256 {
        match shared_root.or_else(|| evidence.shared_source_root.as_deref().map(Path::new)) {
            Some(path) => compare(path, expected, "Shared library"),
            None => {
                result.stale = true;
                result.complete = false;
                result
                    .reasons
                    .push("Shared library source is unavailable".into());
            }
        }
    }
    result
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Acquire) {
        Err("Snapshot preparation cancelled".into())
    } else {
        Ok(())
    }
}
fn root_identity(reader: &ReadRoot) -> Result<String, String> {
    let metadata = reader.directory.metadata().map_err(message)?;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
fn message(error: std::io::Error) -> String {
    error.to_string()
}
fn stamp(metadata: &Metadata) -> (u64, u64, u64, i64, i64, i64, i64) {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}
fn scan(
    reader: &ReadRoot,
    destination: Option<&Path>,
    cancelled: &AtomicBool,
    progress: &mut dyn FnMut(&str, u64),
) -> Result<Vec<EvidenceFile>, String> {
    let mut pending = vec![PathBuf::new()];
    let mut files = Vec::new();
    let mut total = 0;
    let mut entries = 0;
    while let Some(relative) = pending.pop() {
        check_cancelled(cancelled)?;
        reader.check_current()?;
        let directory = reader.path.join(&relative);
        if !fs::symlink_metadata(&directory).map_err(message)?.is_dir() {
            return Err("Source directory changed or became a link during copy".into());
        }
        let mut children = fs::read_dir(directory)
            .map_err(message)?
            .take(MAX_ENTRIES + 1)
            .collect::<Result<Vec<_>, _>>()
            .map_err(message)?;
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            check_cancelled(cancelled)?;
            if relative.as_os_str().is_empty() && entry.file_name() == ".git" {
                continue;
            }
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err("Snapshot exceeds 100000 entries".into());
            }
            let child = relative.join(entry.file_name());
            let path = child
                .to_str()
                .ok_or("Snapshot paths must be valid UTF-8")?
                .to_string();
            let link_metadata = fs::symlink_metadata(reader.path.join(&child)).map_err(message)?;
            let mut input = reader.open(&path, "snapshot input")?;
            let before = input.metadata().map_err(message)?;
            if before.is_dir() {
                if link_metadata.is_symlink() {
                    return Err(format!("Directory symlinks cannot be captured: {path}"));
                }
                if let Some(destination) = destination {
                    fs::create_dir(destination.join(&child)).map_err(message)?;
                }
                files.push(EvidenceFile {
                    path,
                    directory: true,
                    bytes: 0,
                    sha256: String::new(),
                    mode: 0,
                });
                pending.push(child);
                continue;
            }
            if !before.is_file() {
                return Err(format!("Snapshot input is not a regular file: {path}"));
            }
            if before.len() > MAX_FILE_BYTES || total + before.len() > MAX_TOTAL_BYTES {
                return Err("Snapshot exceeds 2 GiB/file or 8 GiB/tree".into());
            }
            let mut output = destination
                .map(|destination| {
                    fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(destination.join(&child))
                })
                .transpose()
                .map_err(message)?;
            let mut hash = Sha256::new();
            let mut size = 0;
            let mut buffer = [0; 64 * 1024];
            loop {
                check_cancelled(cancelled)?;
                let count = input.read(&mut buffer).map_err(message)?;
                if count == 0 {
                    break;
                }
                size += count as u64;
                if size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES {
                    return Err("Snapshot exceeds 2 GiB/file or 8 GiB/tree".into());
                }
                hash.update(&buffer[..count]);
                if let Some(output) = &mut output {
                    output.write_all(&buffer[..count]).map_err(message)?;
                }
                progress(&path, total + size);
            }
            if size != before.len()
                || stamp(&before) != stamp(&input.metadata().map_err(message)?)
                || stamp(&before)
                    != stamp(
                        &reader
                            .open(&path, "snapshot input")?
                            .metadata()
                            .map_err(message)?,
                    )
            {
                return Err(format!(
                    "Snapshot input changed during read; copy is incomplete: {path}"
                ));
            }
            if let Some(output) = output {
                output
                    .set_permissions(fs::Permissions::from_mode(before.mode() & 0o777))
                    .map_err(message)?;
            }
            total += size;
            files.push(EvidenceFile {
                path,
                directory: false,
                bytes: size,
                sha256: format!("{:x}", hash.finalize()),
                mode: before.mode() & 0o777,
            });
        }
    }
    reader.check_current()?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}
fn fingerprint(files: &[EvidenceFile]) -> String {
    let bytes = serde_json::to_vec(files).expect("Evidence file serialization is infallible");
    format!("{:x}", Sha256::digest(bytes))
}
fn read_json(path: &Path) -> Option<serde_json::Value> {
    let input = fs::File::open(path).ok()?;
    if input.metadata().ok()?.len() > 4 * 1024 * 1024 {
        return None;
    }
    serde_json::from_reader(input.take(4 * 1024 * 1024 + 1)).ok()
}
fn dependencies(
    root: &Path,
    references: &[SharedLibraryReference],
    notes: &mut Vec<String>,
) -> Vec<DependencyEvidence> {
    let Some(package) = read_json(&root.join("package.json")) else {
        if root.join("package.json").exists() {
            notes.push("Production dependency inventory could not parse package.json within 4 MiB; its actual bytes remain in the file evidence".into());
        }
        return Vec::new();
    };
    let mut result = Vec::new();
    for (field, optional) in [("dependencies", false), ("optionalDependencies", true)] {
        if let Some(declarations) = package.get(field).and_then(|value| value.as_object()) {
            for (name, value) in declarations {
                let declaration = value
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| value.to_string());
                let safe_name = !Path::new(name).is_absolute()
                    && Path::new(name)
                        .components()
                        .all(|part| matches!(part, std::path::Component::Normal(_)));
                let installed_version = safe_name
                    .then(|| read_json(&root.join("node_modules").join(name).join("package.json")))
                    .flatten()
                    .and_then(|value| {
                        value
                            .get("version")
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    });
                let exact_shared_version = references
                    .iter()
                    .find(|reference| reference.id == *name && reference.version == declaration)
                    .map(|reference| reference.version.clone());
                result.push(DependencyEvidence {
                    name: name.clone(),
                    declaration,
                    optional,
                    installed_version,
                    exact_shared_version,
                });
            }
        }
    }
    result
}
fn git_evidence(root: &Path) -> GitEvidence {
    let mut access = CreationAccess::default();
    let protection = Protection::default();
    let result = access.open(root, &protection).and_then(|workspace| {
        let job = access.prepare_git_status(&workspace.project.identity, &protection)?;
        access.finish_git_status(job.run(&GitReader::default()), &protection)
    });
    match result {
        Ok(report) => GitEvidence {
            head: report.head,
            dirty: if report.detail.is_none() {
                Some(!report.changes.is_empty())
            } else {
                None
            },
            state: format!("{:?}", report.state),
            detail: report.detail,
        },
        Err(error) => GitEvidence {
            head: None,
            dirty: None,
            state: "unavailable".into(),
            detail: Some(format!("Git auxiliary evidence unavailable: {error:?}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn saved_snapshot_stays_independent_and_detects_later_source_changes() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::write(source.path().join("server.js"), "abc").unwrap();
        let cancel = AtomicBool::new(false);
        let prepared =
            prepare_snapshot(source.path(), None, destination.path(), &cancel, |_, _| {}).unwrap();
        assert_eq!(
            fs::read_to_string(prepared.project_root.join("server.js")).unwrap(),
            "abc"
        );
        assert_eq!(
            prepared.evidence.project_files[0].sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(!source_freshness(source.path(), None, &prepared.evidence, &cancel).stale);
        fs::write(prepared.project_root.join("cache"), "generated").unwrap();
        assert!(!source.path().join("cache").exists());
        fs::write(source.path().join("server.js"), "changed").unwrap();
        assert!(source_freshness(source.path(), None, &prepared.evidence, &cancel).stale);
        assert_eq!(
            fs::read_to_string(prepared.project_root.join("server.js")).unwrap(),
            "abc"
        );
    }
}

#[cfg(test)]
mod boundary_tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn preparation_cancellation_preserves_source_and_never_claims_complete_input() {
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("large.bin"), vec![7; 200_000]).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = prepare_snapshot(
            source.path(),
            None,
            destination.path(),
            &cancelled,
            |_, _| cancelled.store(true, Ordering::Release),
        );
        assert!(result.unwrap_err().contains("cancelled"));
        assert_eq!(
            fs::metadata(source.path().join("large.bin")).unwrap().len(),
            200_000
        );
    }

    #[test]
    fn external_links_and_nonregular_inputs_are_not_copied() {
        let source = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("private"), "outside").unwrap();
        symlink(outside.path().join("private"), source.path().join("escape")).unwrap();
        let destination = tempfile::tempdir().unwrap();
        assert!(prepare_snapshot(
            source.path(),
            None,
            destination.path(),
            &AtomicBool::new(false),
            |_, _| {}
        )
        .is_err());
        assert!(!destination.path().join("project/escape").exists());
    }

    #[test]
    fn replacing_the_source_root_invalidates_even_identical_content() {
        let parent = tempfile::tempdir().unwrap();
        let source = parent.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("a"), "abc").unwrap();
        let destination = tempfile::tempdir().unwrap();
        let cancelled = AtomicBool::new(false);
        let captured =
            prepare_snapshot(&source, None, destination.path(), &cancelled, |_, _| {}).unwrap();
        fs::rename(&source, parent.path().join("old")).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("a"), "abc").unwrap();
        assert!(source_freshness(&source, None, &captured.evidence, &cancelled).stale);
    }
}

#[cfg(test)]
mod content_tests {
    use super::*;

    #[test]
    fn shared_and_local_dependency_versions_are_captured_and_cannot_drift_silently() {
        let source = tempfile::tempdir().unwrap();
        let libraries = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::write(
            source.path().join("manifest.json"),
            r#"{"sharedLibraries":[{"id":"express","version":"5.3.0"}]}"#,
        )
        .unwrap();
        fs::write(
            source.path().join("package.json"),
            r#"{"dependencies":{"express":"5.3.0","local":"^1.0.0"}}"#,
        )
        .unwrap();
        fs::create_dir_all(source.path().join("node_modules/local")).unwrap();
        fs::write(
            source.path().join("node_modules/local/package.json"),
            r#"{"name":"local","version":"1.2.0"}"#,
        )
        .unwrap();
        fs::create_dir(libraries.path().join("node")).unwrap();
        fs::write(libraries.path().join("node/express.js"), "original").unwrap();
        fs::write(libraries.path().join("catalog.json"),r#"{"schemaVersion":1,"libraries":[{"id":"express","version":"5.3.0","kind":"node","entry":"node/express.js","source":{"url":"fixture","integrity":"fixture"},"files":[{"path":"node/express.js","bytes":8,"sha256":"0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5"}]}]}"#).unwrap();
        let cancel = AtomicBool::new(false);
        let prepared = prepare_snapshot(
            source.path(),
            Some(libraries.path()),
            destination.path(),
            &cancel,
            |_, _| {},
        )
        .unwrap();
        assert_eq!(
            prepared
                .evidence
                .production_dependencies
                .iter()
                .find(|dependency| dependency.name == "local")
                .unwrap()
                .installed_version
                .as_deref(),
            Some("1.2.0")
        );
        assert_eq!(
            prepared
                .evidence
                .production_dependencies
                .iter()
                .find(|dependency| dependency.name == "express")
                .unwrap()
                .exact_shared_version
                .as_deref(),
            Some("5.3.0")
        );
        assert!(
            !source_freshness(
                source.path(),
                Some(libraries.path()),
                &prepared.evidence,
                &cancel
            )
            .stale
        );
        fs::write(
            source.path().join("node_modules/local/package.json"),
            r#"{"name":"local","version":"1.3.0"}"#,
        )
        .unwrap();
        assert!(
            source_freshness(
                source.path(),
                Some(libraries.path()),
                &prepared.evidence,
                &cancel
            )
            .stale
        );
        fs::write(libraries.path().join("node/express.js"), "changed").unwrap();
        assert_eq!(
            fs::read_to_string(prepared.shared_root.unwrap().join("node/express.js")).unwrap(),
            "original"
        );
        assert!(source_freshness(
            source.path(),
            Some(libraries.path()),
            &prepared.evidence,
            &cancel
        )
        .reasons
        .iter()
        .any(|reason| reason.contains("Shared library")));
    }

    #[test]
    fn changes_during_copy_are_explained_and_each_saved_input_has_its_own_hash() {
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("a"), "abc").unwrap();
        fs::write(source.path().join("z"), "last").unwrap();
        let destination = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let prepared = prepare_snapshot(
            source.path(),
            None,
            destination.path(),
            &cancel,
            |path, _| {
                if path == "z" {
                    fs::write(source.path().join("a"), "updated").unwrap();
                }
            },
        )
        .unwrap();
        assert!(prepared.evidence.changed_during_preparation);
        assert_eq!(
            fs::read_to_string(prepared.project_root.join("a")).unwrap(),
            "abc"
        );
        assert!(source_freshness(source.path(), None, &prepared.evidence, &cancel).stale);
    }

    #[test]
    fn an_input_modified_while_reading_is_an_incomplete_preparation() {
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("large"), vec![0; 200_000]).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let result = prepare_snapshot(
            source.path(),
            None,
            destination.path(),
            &AtomicBool::new(false),
            |_, _| {
                fs::write(source.path().join("large"), "replaced").unwrap();
            },
        );
        assert!(result.unwrap_err().contains("incomplete"));
    }
}

#[cfg(test)]
mod git_and_limit_tests {
    use super::*;

    #[test]
    fn git_head_is_separate_from_the_actual_uncommitted_saved_content() {
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("manifest.json"),r#"{"schemaVersion":1,"id":"test","name":"Test","version":"1.0.0","scoreServer":{"entry":"server.js","workingDirectory":".","performerPort":6868,"monitorPort":6869},"audio":{"defaultMode":"none","supportedModes":["none"]}}"#).unwrap();
        fs::write(source.path().join("server.js"), "committed").unwrap();
        let repo = git2::Repository::init(source.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("manifest.json")).unwrap();
        index.add_path(Path::new("server.js")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Evidence Test", "evidence@example.invalid").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap();
        let cancel = AtomicBool::new(false);
        let first_destination = tempfile::tempdir().unwrap();
        let first = prepare_snapshot(
            source.path(),
            None,
            first_destination.path(),
            &cancel,
            |_, _| {},
        )
        .unwrap();
        assert_eq!(first.evidence.git.dirty, Some(false));
        fs::write(source.path().join("server.js"), "saved uncommitted").unwrap();
        let second_destination = tempfile::tempdir().unwrap();
        let second = prepare_snapshot(
            source.path(),
            None,
            second_destination.path(),
            &cancel,
            |_, _| {},
        )
        .unwrap();
        assert_eq!(second.evidence.git.head, first.evidence.git.head);
        assert_eq!(second.evidence.git.dirty, Some(true));
        assert_ne!(
            second.evidence.project_sha256,
            first.evidence.project_sha256
        );
        assert!(!second.project_root.join(".git").exists());
    }

    #[test]
    fn sparse_files_over_the_documented_bound_fail_without_claiming_complete_copy() {
        let source = tempfile::tempdir().unwrap();
        fs::File::create(source.path().join("huge"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        let destination = tempfile::tempdir().unwrap();
        assert!(prepare_snapshot(
            source.path(),
            None,
            destination.path(),
            &AtomicBool::new(false),
            |_, _| {}
        )
        .unwrap_err()
        .contains("2 GiB/file"));
    }
}
