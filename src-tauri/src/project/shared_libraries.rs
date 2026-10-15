//! Exact, offline App library resolution. Models and author sources stay in projects.
use super::contained_read::ReadRoot;
use crate::project::manifest::{exact_library_version, SharedLibraryReference, SHARED_LIBRARY_IDS};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::{BTreeMap, HashMap, HashSet};
#[cfg(test)]
use std::fs;
use std::fs::{File, Metadata};
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SharedLibraryKind {
    Browser,
    Node,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedLibrarySource {
    pub url: String,
    pub integrity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: String,
    pub version: String,
    pub kind: SharedLibraryKind,
    pub entry: String,
    pub browser_entry: Option<String>,
    pub source: SharedLibrarySource,
    pub files: Vec<LibraryFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCatalog {
    schema_version: u32,
    pub libraries: Vec<Library>,
}

/// Paths are for the score server only; browsers receive an author-defined same-origin URL.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLibrary {
    pub version: String,
    pub kind: SharedLibraryKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_path: Option<String>,
}
pub type ResolvedLibraries = BTreeMap<String, ResolvedLibrary>;

#[derive(Clone, PartialEq, Eq)]
struct FileStamp {
    device: u64,
    inode: u64,
    bytes: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

impl From<Metadata> for FileStamp {
    fn from(metadata: Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            bytes: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        }
    }
}

struct VerifiedFile {
    path: PathBuf,
    stamp: FileStamp,
    sha256: String,
}

struct VerifiedCatalog {
    root: PathBuf,
    stamp: FileStamp,
    catalog: LibraryCatalog,
    files: HashMap<String, VerifiedFile>,
}

/// Process-local verification of one App resource directory. Successful content
/// hashes are reusable only while the catalog and each file's identity and
/// change timestamps remain unchanged. No validation result is persisted.
#[derive(Default)]
pub struct SharedLibraryResolver {
    verified: Mutex<Option<VerifiedCatalog>>,
}

impl SharedLibraryResolver {
    pub fn resolve_at(
        &self,
        root: &Path,
        references: &[SharedLibraryReference],
    ) -> Result<ResolvedLibraries, String> {
        if references.is_empty() {
            return Ok(BTreeMap::new());
        }
        let reader = ReadRoot::new(root).map_err(|error| {
            required_error(
                references,
                format!("App shared library directory missing: {error}"),
            )
        })?;
        self.resolve(&reader, references, None)
            .map_err(|detail| required_error(references, detail))
    }

    /// Static diagnostics bound and fingerprint a captured catalog before
    /// checking resources. Do not substitute a later catalog's inventory.
    pub(crate) fn resolve_observed_at(
        &self,
        root: &ReadRoot,
        references: &[SharedLibraryReference],
        observed_catalog: &Metadata,
    ) -> Result<ResolvedLibraries, String> {
        self.resolve(
            root,
            references,
            Some(FileStamp::from(observed_catalog.clone())),
        )
        .map_err(|detail| required_error(references, detail))
    }

    fn resolve(
        &self,
        reader: &ReadRoot,
        references: &[SharedLibraryReference],
        observed_catalog: Option<FileStamp>,
    ) -> Result<ResolvedLibraries, String> {
        let root = &reader.path;
        // Serialize verification, so concurrent requests share a completed scan
        // rather than hashing the same immutable App files in parallel.
        let mut verified = self
            .verified
            .lock()
            .map_err(|_| "App shared library verification cache is unavailable")?;
        let stamp = FileStamp::from(shared_metadata(reader, "catalog.json")?);
        if observed_catalog.is_some_and(|observed| observed != stamp) {
            return Err("App shared library catalog changed after observation; check again".into());
        }
        if !verified
            .as_ref()
            .is_some_and(|cached| cached.root == *root && cached.stamp == stamp)
        {
            *verified = None;
            let catalog = LibraryCatalog::load_with_reader(reader)?;
            if FileStamp::from(shared_metadata(reader, "catalog.json")?) != stamp {
                return Err("App shared library catalog changed during verification".into());
            }
            *verified = Some(VerifiedCatalog {
                root: root.clone(),
                stamp: stamp.clone(),
                catalog,
                files: HashMap::new(),
            });
        }
        let cached = verified.as_mut().expect("the catalog was loaded above");
        let result = cached
            .catalog
            .resolve_verified(reader, references, &mut cached.files);
        // A catalog replaced while its resources were checked invalidates the
        // whole result, including otherwise successful file hashes.
        let unchanged = shared_metadata(reader, "catalog.json")
            .map(|metadata| FileStamp::from(metadata) == stamp)
            .unwrap_or(false);
        if result.is_err() || !unchanged {
            *verified = None;
        }
        if !unchanged {
            return Err("App shared library catalog changed during verification".into());
        }
        if let Err(error) = reader.check_current() {
            *verified = None;
            return Err(error);
        }
        result
    }
}

fn verify_file(
    reader: &ReadRoot,
    resource: &LibraryFile,
    verified: &mut HashMap<String, VerifiedFile>,
) -> Result<(), String> {
    let root = &reader.path;
    let path = within(root, &resource.path)?;
    let mut file = open_shared(reader, &resource.path)?;
    let stamp = FileStamp::from(file.metadata().map_err(|error| error.to_string())?);
    if stamp.bytes != resource.bytes {
        return Err(format!("{} size mismatch", resource.path));
    }
    let expected = resource.sha256.to_ascii_lowercase();
    let reusable = verified.get(&resource.path).is_some_and(|cached| {
        cached.path == path && cached.stamp == stamp && cached.sha256 == expected
    });
    if !reusable {
        verified.remove(&resource.path);
        let mut hash = Sha256::new();
        let mut buffer = [0; 65536];
        let mut bounded = (&mut file).take(resource.bytes.saturating_add(1));
        loop {
            let read = bounded
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        if format!("{:x}", hash.finalize()) != expected {
            return Err(format!("{} SHA-256 mismatch", resource.path));
        }
    }
    if FileStamp::from(file.metadata().map_err(|error| error.to_string())?) != stamp
        || FileStamp::from(shared_metadata(reader, &resource.path)?) != stamp
        || within(root, &resource.path)? != path
    {
        verified.remove(&resource.path);
        return Err(format!("{} changed during verification", resource.path));
    }
    verified.insert(
        resource.path.clone(),
        VerifiedFile {
            path,
            stamp,
            sha256: expected,
        },
    );
    Ok(())
}

fn within(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!(
            "Shared library resource path must stay within its directory: {relative}"
        ));
    }
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("Shared library resource missing: {relative}: {error}"))?;
    if !path.starts_with(root) || !path.is_file() {
        return Err(format!(
            "Shared library resource escapes its directory or is not a file: {relative}"
        ));
    }
    Ok(path)
}

fn open_shared(reader: &ReadRoot, relative: &str) -> Result<File, String> {
    within(&reader.path, relative)?;
    let file = reader.open(relative, "Shared library resource")?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err(format!("Shared library resource is not a file: {relative}"));
    }
    Ok(file)
}

fn shared_metadata(reader: &ReadRoot, relative: &str) -> Result<Metadata, String> {
    open_shared(reader, relative)?
        .metadata()
        .map_err(|error| error.to_string())
}

impl LibraryCatalog {
    pub fn load(root: &Path) -> Result<Self, String> {
        let reader = ReadRoot::new(root)
            .map_err(|error| format!("App shared library directory missing: {error}"))?;
        Self::load_with_reader(&reader)
    }

    pub(crate) fn load_with_reader(reader: &ReadRoot) -> Result<Self, String> {
        let mut file = open_shared(reader, "catalog.json")?;
        let stamp = FileStamp::from(file.metadata().map_err(|e| e.to_string())?);
        let mut bytes = Vec::new();
        (&mut file)
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("App shared library catalog exceeds 32 MiB".into());
        }
        if FileStamp::from(file.metadata().map_err(|e| e.to_string())?) != stamp
            || FileStamp::from(shared_metadata(reader, "catalog.json")?) != stamp
        {
            return Err("App shared library catalog changed during verification".into());
        }
        let catalog: Self = serde_json::from_slice(&bytes)
            .map_err(|error| format!("App shared library catalog is invalid: {error}"))?;
        if catalog.schema_version != 1 {
            return Err("Unsupported App shared library catalog schema".into());
        }
        let mut ids = HashSet::new();
        for library in &catalog.libraries {
            if !SHARED_LIBRARY_IDS.contains(&library.id.as_str())
                || !exact_library_version(&library.version)
                || !ids.insert(&library.id)
            {
                return Err(format!(
                    "Invalid or repeated App shared library: {} {}",
                    library.id, library.version
                ));
            }
            let paths: HashSet<_> = library
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect();
            if library.files.is_empty()
                || paths.len() != library.files.len()
                || !paths.contains(library.entry.as_str())
                || library
                    .browser_entry
                    .as_ref()
                    .is_some_and(|path| !paths.contains(path.as_str()))
                || library.source.url.is_empty()
                || library.source.integrity.is_empty()
                || library.files.iter().any(|file| {
                    file.sha256.len() != 64
                        || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
            {
                return Err(format!(
                    "Incomplete App shared library record: {} {}",
                    library.id, library.version
                ));
            }
        }
        reader.check_current()?;
        Ok(catalog)
    }

    pub fn resolve(
        &self,
        root: &Path,
        references: &[SharedLibraryReference],
    ) -> Result<ResolvedLibraries, String> {
        // Bundle validation always performs a fresh complete content scan.
        let reader = ReadRoot::new(root)
            .map_err(|error| format!("App shared library directory missing: {error}"))?;
        self.resolve_verified(&reader, references, &mut HashMap::new())
    }

    fn resolve_verified(
        &self,
        reader: &ReadRoot,
        references: &[SharedLibraryReference],
        verified: &mut HashMap<String, VerifiedFile>,
    ) -> Result<ResolvedLibraries, String> {
        let root = &reader.path;
        let mut resolved = BTreeMap::new();
        let mut checked = HashSet::new();
        for reference in references {
            let id = &reference.id;
            let version = &reference.version;
            let library = self.libraries.iter().find(|library| library.id == *id && library.version == *version)
                .ok_or_else(|| format!("App does not provide required shared library {id} {version}; no version substitution is allowed"))?;
            for resource in &library.files {
                if checked.insert((
                    resource.path.as_str(),
                    resource.bytes,
                    resource.sha256.as_str(),
                )) {
                    verify_file(reader, resource, verified).map_err(|detail| {
                        format!("Shared library {id} {version} is damaged: {detail}")
                    })?;
                }
            }
            resolved.insert(
                id.clone(),
                ResolvedLibrary {
                    version: version.clone(),
                    kind: library.kind.clone(),
                    path: within(root, &library.entry)?.to_string_lossy().into_owned(),
                    browser_path: library
                        .browser_entry
                        .as_ref()
                        .map(|path| {
                            within(root, path).map(|path| path.to_string_lossy().into_owned())
                        })
                        .transpose()?,
                },
            );
        }
        reader.check_current()?;
        Ok(resolved)
    }
}

/// Pure resource lookup for packaging/install services that have no App handle.
pub fn default_root() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let parent = executable
        .parent()
        .ok_or("Cannot locate App resource directory")?;
    #[allow(unused_mut)]
    let mut candidates = vec![
        parent.join("../Resources/resources/shared-libraries"),
        parent.join("../Resources/shared-libraries"),
    ];
    #[cfg(debug_assertions)]
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"));
    candidates
        .into_iter()
        .find(|root| root.join("catalog.json").is_file())
        .ok_or_else(|| {
            "App shared library resources are missing; required exact versions cannot be resolved"
                .into()
        })
}

pub fn shipped_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    #[allow(unused_mut)]
    let mut candidates = vec![
        resources.join("resources/shared-libraries"),
        resources.join("shared-libraries"),
    ];
    #[cfg(debug_assertions)]
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries"));
    candidates
        .into_iter()
        .find(|root| root.join("catalog.json").is_file())
        .map(Ok)
        .unwrap_or_else(default_root)
}

pub(crate) fn required_error(references: &[SharedLibraryReference], detail: String) -> String {
    let required = references
        .iter()
        .map(|SharedLibraryReference { id, version }| format!("{id} {version}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("Required shared libraries [{required}] cannot be verified: {detail}")
}

/// Resolves a project's exact references against a local App resource directory.
pub fn resolve_at(
    root: &Path,
    references: &[SharedLibraryReference],
) -> Result<ResolvedLibraries, String> {
    static RESOLVER: OnceLock<SharedLibraryResolver> = OnceLock::new();
    RESOLVER
        .get_or_init(SharedLibraryResolver::default)
        .resolve_at(root, references)
}

pub fn resolve_for_app<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    references: &[SharedLibraryReference],
) -> Result<ResolvedLibraries, String> {
    if references.is_empty() {
        return Ok(BTreeMap::new());
    }
    let root = shipped_root(app).map_err(|detail| required_error(references, detail))?;
    resolve_at(&root, references)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINAL_SHA256: &str =
        "0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5";

    fn node_fixture(root: &Path) -> Vec<SharedLibraryReference> {
        fs::create_dir_all(root.join("node")).unwrap();
        fs::write(root.join("node/entry.js"), b"original").unwrap();
        fs::write(root.join("node/dependency.js"), b"original").unwrap();
        let references = [
            ("express", "5.3.0"),
            ("qrcode", "1.5.4"),
            ("socket.io", "4.8.4"),
        ];
        let libraries: Vec<_> = references.iter().map(|(id, version)| {
            serde_json::json!({
                "id": id, "version": version, "kind": "node", "entry": "node/entry.js",
                "source": {"url": "https://registry.npmjs.org/fixture.tgz", "integrity": "sha512-fixture"},
                "files": [
                    {"path": "node/entry.js", "bytes": 8, "sha256": ORIGINAL_SHA256},
                    {"path": "node/dependency.js", "bytes": 8, "sha256": ORIGINAL_SHA256}
                ]
            })
        }).collect();
        fs::write(
            root.join("catalog.json"),
            serde_json::json!({"schemaVersion": 1, "libraries": libraries}).to_string(),
        )
        .unwrap();
        references
            .iter()
            .map(|(id, version)| SharedLibraryReference {
                id: (*id).into(),
                version: (*version).into(),
            })
            .collect()
    }

    fn overwrite_preserving_size_and_mtime(path: &Path, bytes: &[u8]) {
        let old = fs::metadata(path).unwrap();
        assert_eq!(bytes.len() as u64, old.len());
        fs::write(path, bytes).unwrap();
        File::open(path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(old.modified().unwrap()))
            .unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().modified().unwrap(),
            old.modified().unwrap()
        );
    }

    #[test]
    fn cached_resolution_rejects_same_size_dependency_damage_with_restored_mtime() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        let expected = resolver.resolve_at(temp.path(), &references).unwrap();
        assert_eq!(
            resolver.resolve_at(temp.path(), &references).unwrap(),
            expected
        );
        overwrite_preserving_size_and_mtime(&temp.path().join("node/dependency.js"), b"tampered");
        let error = resolver.resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("express 5.3.0"), "{error}");
        assert!(error.contains("dependency.js SHA-256 mismatch"), "{error}");
        fs::write(temp.path().join("node/dependency.js"), b"original").unwrap();
        assert_eq!(
            resolver.resolve_at(temp.path(), &references).unwrap(),
            expected
        );
    }

    #[test]
    fn cached_resolution_rejects_missing_and_atomically_replaced_resources() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        let expected = resolver.resolve_at(temp.path(), &references).unwrap();
        let dependency = temp.path().join("node/dependency.js");
        let modified = fs::metadata(&dependency).unwrap().modified().unwrap();
        fs::remove_file(&dependency).unwrap();
        assert!(resolver
            .resolve_at(temp.path(), &references)
            .unwrap_err()
            .contains("resource missing"));
        fs::write(&dependency, b"original").unwrap();
        assert_eq!(
            resolver.resolve_at(temp.path(), &references).unwrap(),
            expected
        );
        let replacement = temp.path().join("replacement.js");
        fs::write(&replacement, b"tampered").unwrap();
        File::open(&replacement)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        fs::rename(replacement, dependency).unwrap();
        let error = resolver.resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("dependency.js SHA-256 mismatch"), "{error}");
    }

    #[test]
    fn cached_resolution_rechecks_changed_catalog_with_restored_mtime() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        resolver.resolve_at(temp.path(), &references).unwrap();
        let path = temp.path().join("catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        catalog["libraries"][0]["files"][1]["sha256"] = "0".repeat(64).into();
        overwrite_preserving_size_and_mtime(&path, catalog.to_string().as_bytes());
        let error = resolver.resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("dependency.js SHA-256 mismatch"), "{error}");
    }

    #[test]
    fn cached_resolution_still_requires_the_exact_current_catalog_version() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        resolver.resolve_at(temp.path(), &references).unwrap();
        let path = temp.path().join("catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        catalog["libraries"][0]["version"] = "5.3.1".into();
        overwrite_preserving_size_and_mtime(&path, catalog.to_string().as_bytes());
        let error = resolver.resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("express 5.3.0"), "{error}");
        assert!(error.contains("no version substitution"), "{error}");
    }

    #[test]
    fn cached_resolution_rejects_a_resource_directory_redirected_outside_the_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("resources");
        let references = node_fixture(&root);
        let resolver = SharedLibraryResolver::default();
        resolver.resolve_at(&root, &references).unwrap();
        let outside = temp.path().join("outside");
        fs::rename(root.join("node"), &outside).unwrap();
        std::os::unix::fs::symlink(outside, root.join("node")).unwrap();
        let error = resolver.resolve_at(&root, &references).unwrap_err();
        assert!(error.contains("escapes its directory"), "{error}");
    }

    #[test]
    fn cached_resolution_verifies_each_new_within_root_link_target() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        let entry = temp.path().join("node/entry.js");
        resolver.resolve_at(temp.path(), &references).unwrap();
        for name in ["first.js", "second.js"] {
            let target = temp.path().join("node").join(name);
            fs::write(&target, b"original").unwrap();
            fs::remove_file(&entry).unwrap();
            std::os::unix::fs::symlink(&target, &entry).unwrap();
            let resolved = resolver.resolve_at(temp.path(), &references).unwrap();
            assert_eq!(
                Path::new(&resolved["express"].path),
                target.canonicalize().unwrap()
            );
        }
        let target = temp.path().join("node/tampered.js");
        fs::write(&target, b"tampered").unwrap();
        fs::remove_file(&entry).unwrap();
        std::os::unix::fs::symlink(target, entry).unwrap();
        let error = resolver.resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("entry.js SHA-256 mismatch"), "{error}");
    }

    #[test]
    fn cached_resolution_does_not_trust_a_replacement_resource_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("resources");
        let references = node_fixture(&root);
        let resolver = SharedLibraryResolver::default();
        resolver.resolve_at(&root, &references).unwrap();
        fs::rename(&root, temp.path().join("previous")).unwrap();
        node_fixture(&root);
        fs::write(root.join("node/dependency.js"), b"tampered").unwrap();
        let error = resolver.resolve_at(&root, &references).unwrap_err();
        assert!(error.contains("dependency.js SHA-256 mismatch"), "{error}");
    }

    #[test]
    fn overlapping_library_records_cannot_hide_conflicting_integrity_requirements() {
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let path = temp.path().join("catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        catalog["libraries"][1]["files"][1]["sha256"] = "0".repeat(64).into();
        fs::write(&path, catalog.to_string()).unwrap();
        let error = resolve_at(temp.path(), &references).unwrap_err();
        assert!(error.contains("qrcode 1.5.4"), "{error}");
        assert!(error.contains("SHA-256 mismatch"), "{error}");
        // The uncached pack/install boundary must apply the same requirements.
        assert!(LibraryCatalog::load(temp.path())
            .unwrap()
            .resolve(temp.path(), &references)
            .unwrap_err()
            .contains("SHA-256 mismatch"));
    }

    /// Uses the actual shipped resources; run explicitly for local performance
    /// evidence rather than imposing a machine-speed threshold on normal CI.
    #[test]
    #[ignore]
    fn repeated_shipped_shared_project_resolution_is_faster_after_full_verification() {
        use std::time::Instant;
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/shared-libraries");
        let project =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/utilities/mobile-sensor-meter");
        let manifest = crate::project::manifest::load_manifest(&project).unwrap();
        assert!(manifest.shared_libraries.len() >= 3);
        let started = Instant::now();
        let first = resolve_at(&resources, &manifest.shared_libraries).unwrap();
        let first_time = started.elapsed();
        let mut subsequent = Vec::new();
        for _ in 0..3 {
            let started = Instant::now();
            assert_eq!(
                resolve_at(&resources, &manifest.shared_libraries).unwrap(),
                first
            );
            subsequent.push(started.elapsed());
        }
        subsequent.sort();
        let median = subsequent[1];
        println!("Complete first resolution: {first_time:?}; subsequent median: {median:?}; samples: {subsequent:?}");
        assert!(
            median < first_time / 2,
            "unchanged resources still incur repeated full verification cost"
        );
    }

    #[test]
    fn required_library_resolution_names_exact_references_when_resources_are_unavailable() {
        let temp = tempfile::tempdir().unwrap();
        let missing_root = temp.path().join("missing");
        let missing_catalog = temp.path().join("without-catalog");
        std::fs::create_dir(&missing_catalog).unwrap();
        let invalid_catalog = temp.path().join("invalid-catalog");
        std::fs::create_dir(&invalid_catalog).unwrap();
        std::fs::write(invalid_catalog.join("catalog.json"), b"invalid JSON").unwrap();
        let references = [
            SharedLibraryReference {
                id: "p5".into(),
                version: "2.3.4".into(),
            },
            SharedLibraryReference {
                id: "express".into(),
                version: "5.3.0".into(),
            },
        ];
        for (root, cause) in [
            (&missing_root, "directory missing"),
            (&missing_catalog, "catalog.json"),
            (&invalid_catalog, "catalog is invalid"),
        ] {
            let error = resolve_at(root, &references).unwrap_err();
            assert!(error.contains("p5 2.3.4"), "{error}");
            assert!(error.contains("express 5.3.0"), "{error}");
            assert!(error.contains(cause), "{error}");
        }
    }

    #[test]
    fn projects_without_shared_references_need_no_resource_directory() {
        let temp = tempfile::tempdir().unwrap();
        assert!(resolve_at(&temp.path().join("missing"), &[])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn public_resolvers_reject_nonregular_replacements_without_waiting_for_a_writer() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let temp = tempfile::tempdir().unwrap();
        let references = node_fixture(temp.path());
        let resolver = SharedLibraryResolver::default();
        resolver.resolve_at(temp.path(), &references).unwrap();
        let catalog = LibraryCatalog::load(temp.path()).unwrap();
        let entry = temp.path().join("node/entry.js");
        fs::rename(&entry, temp.path().join("node/previous.js")).unwrap();
        let fifo = CString::new(entry.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(resolver
            .resolve_at(temp.path(), &references)
            .unwrap_err()
            .contains("not a file"));
        assert!(catalog
            .resolve(temp.path(), &references)
            .unwrap_err()
            .contains("not a file"));
        let path = temp.path().join("catalog.json");
        fs::rename(&path, temp.path().join("previous-catalog.json")).unwrap();
        let fifo = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(LibraryCatalog::load(temp.path())
            .err()
            .unwrap()
            .contains("not a file"));
        assert!(resolver
            .resolve_at(temp.path(), &references)
            .unwrap_err()
            .contains("not a file"));
    }
}
