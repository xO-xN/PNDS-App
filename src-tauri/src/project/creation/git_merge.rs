//! Durable isolated merge candidates. Real project writes begin only at publication.
use super::*;
use git2::{ObjectType, Oid, Repository};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::PermissionsExt;

mod assistant;
mod candidate;
pub use assistant::*;
mod publication;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeRelation {
    Included,
    FastForward,
    Diverged,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergePhase {
    Active,
    Paused,
    Stale,
    Publishing,
    Recovery,
    Completed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeFileKind {
    Text,
    Image,
    Audio,
    Binary,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeConflictKind {
    Text,
    Binary,
    DeleteModify,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeSide {
    Base,
    Current,
    Incoming,
    Result,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitMergeChoice {
    Current,
    Incoming,
    Delete,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeProbe {
    pub relation: GitMergeRelation,
    pub source: String,
    pub target: String,
    pub base: Option<String>,
    pub branch: Option<String>,
    pub dirty: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeFile {
    pub path: String,
    pub status: String,
    pub kind: GitMergeFileKind,
    pub conflict: Option<GitMergeConflictKind>,
    pub resolved: bool,
    pub version: String,
    pub current: bool,
    pub incoming: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeCandidate {
    pub id: String,
    pub revision: u32,
    pub relation: GitMergeRelation,
    pub phase: GitMergePhase,
    pub source: String,
    pub target: String,
    pub base: Option<String>,
    pub branch: Option<String>,
    pub name: String,
    pub files: Vec<GitMergeFile>,
    pub unresolved: u32,
    pub result: Option<String>,
    pub detail: Option<String>,
    pub assistant_owner: Option<String>,
    pub can_undo: bool,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeContent {
    pub path: String,
    pub side: GitMergeSide,
    pub exists: bool,
    pub version: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub size: f64,
    pub mime: Option<String>,
    pub duration_ms: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub waveform: Option<Vec<f32>>,
}
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitMergeEdit {
    pub path: String,
    pub version: String,
    pub text: Option<String>,
    pub choice: Option<GitMergeChoice>,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeRound {
    pub id: String,
    pub candidate: GitMergeCandidate,
}
pub struct GitMergeArtifact {
    pub path: String,
    pub bytes: Vec<u8>,
}
pub struct GitMergeSnapshot {
    pub candidate: GitMergeCandidate,
    pub project_root: PathBuf,
    pub fingerprint: String,
    pub root: PathBuf,
    pub _directory: tempfile::TempDir,
    pub managed_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    oid: String,
    mode: u32,
}
type Entries = BTreeMap<String, Entry>;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Conflict {
    kind: GitMergeConflictKind,
    resolved: bool,
    markers: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Checkpoint {
    id: String,
    before: Entries,
    after: Entries,
    before_conflicts: BTreeMap<String, Conflict>,
    after_conflicts: BTreeMap<String, Conflict>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Publication {
    #[serde(default)]
    author_name: String,
    #[serde(default)]
    author_email: String,
    #[serde(default)]
    author_time: i64,
    #[serde(default)]
    author_offset: i32,
    result: String,
    branch: String,
    old_branch: Option<String>,
    old_index: Option<String>,
    new_index: String,
    paths: Vec<String>,
    old: Entries,
    new: Entries,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    schema: u32,
    id: String,
    root: String,
    root_key: String,
    revision: u32,
    phase: GitMergePhase,
    relation: GitMergeRelation,
    source: String,
    target: String,
    base: Option<String>,
    branch: Option<String>,
    baseline: String,
    name: String,
    current: Entries,
    incoming: Entries,
    ancestor: Entries,
    entries: Entries,
    conflicts: BTreeMap<String, Conflict>,
    owner: Option<String>,
    #[serde(default)]
    checkpoint: Option<Checkpoint>,
    #[serde(default)]
    pending_round: Option<Checkpoint>,
    publication: Option<Publication>,
    detail: Option<String>,
}
const MAX_RECORD: u64 = 32 * 1024 * 1024;
const ACTIVE: &str = "merge-active.json";
fn invalid(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn conflict(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, detail)
}
fn git(error: git2::Error) -> CreationError {
    local_git::git_error(error)
}
fn parse(id: &str) -> Result<Oid, CreationError> {
    Oid::from_str(id).map_err(git)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn root_key(project: &OpenProject) -> Result<String, CreationError> {
    let metadata = project.directory.metadata().map_err(io_error)?;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}
fn private_root(project: &OpenProject) -> Result<PathBuf, CreationError> {
    let held = crate::creation_data::open(&project.directory).map_err(io_error)?;
    let path = native_git::held_path(&held)?;
    if path != project.root.join(crate::creation_data::DIRECTORY) {
        return Err(conflict("Private creation data moved; reopen the project"));
    }
    Ok(path)
}
fn checked_record_parent(path: &Path) -> Result<File, CreationError> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Invalid private record path"))?;
    if fs::canonicalize(parent).map_err(io_error)? != parent {
        return Err(conflict(
            "Private merge record directories must not use aliases",
        ));
    }
    let directory = File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(parent)
        .map_err(io_error)?;
    let metadata = directory.metadata().map_err(io_error)?;
    let observed = fs::metadata(parent).map_err(io_error)?;
    if fs::canonicalize(parent).map_err(io_error)? != parent
        || metadata.dev() != observed.dev()
        || metadata.ino() != observed.ino()
    {
        return Err(conflict("Private merge record directory changed"));
    }
    Ok(directory)
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, CreationError> {
    let directory = checked_record_parent(path)?;
    let name = CString::new(
        path.file_name()
            .ok_or_else(|| invalid("Missing private record name"))?
            .as_bytes(),
    )
    .map_err(|_| invalid("Invalid private record name"))?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let bytes = bounded_read(file, MAX_RECORD)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| invalid(format!("Invalid merge record: {error}")))
}
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), CreationError> {
    let bytes = serde_json::to_vec(value).map_err(|error| invalid(error.to_string()))?;
    if bytes.len() as u64 > MAX_RECORD {
        return Err(invalid("Merge record is too large"));
    }
    let directory = checked_record_parent(path)?;
    let metadata = directory.metadata().map_err(io_error)?;
    let name = CString::new(
        path.file_name()
            .ok_or_else(|| invalid("Missing private record name"))?
            .as_bytes(),
    )
    .map_err(|_| invalid("Invalid private record name"))?;
    let receipt = text_publication::publish_text_at(
        text_publication::TextPublication {
            directory: &directory,
            name: &name,
            bytes: &bytes,
            policy: text_publication::PublishPolicy::Replace {
                permissions: fs::Permissions::from_mode(0o600),
            },
        },
        || {
            let current = checked_record_parent(path)?.metadata().map_err(io_error)?;
            if current.dev() != metadata.dev() || current.ino() != metadata.ino() {
                return Err(conflict(
                    "Private merge record directory changed before publication",
                ));
            }
            Ok(())
        },
    )?;
    if receipt.state != text_publication::PublicationState::Installed {
        return Err(conflict("Private merge record became occupied"));
    }
    directory.sync_all().map_err(io_error)
}
fn operation_path(project: &OpenProject, id: &str) -> Result<PathBuf, CreationError> {
    if !id.starts_with("merge-")
        || id.len() > 100
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(invalid("Invalid merge candidate"));
    }
    let root = private_root(project)?.join(id);
    let metadata = fs::symlink_metadata(&root).map_err(io_error)?;
    if !metadata.is_dir() || metadata.is_symlink() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(invalid("Invalid merge private directory"));
    }
    Ok(root)
}
fn load(project: &OpenProject, id: &str) -> Result<Record, CreationError> {
    let path = operation_path(project, id)?;
    let record: Record = read_json(&path.join("state.json"))?;
    if record.schema != 1 || record.id != id || record.root_key != root_key(project)? {
        return Err(conflict("Merge candidate belongs to another project"));
    }
    Ok(record)
}
fn save(project: &OpenProject, record: &Record) -> Result<(), CreationError> {
    project.merge_audio_grants.borrow_mut().clear();
    write_json(
        &operation_path(project, &record.id)?.join("state.json"),
        record,
    )
}
fn active_id(project: &OpenProject) -> Result<Option<String>, CreationError> {
    let path = project
        .root
        .join(crate::creation_data::DIRECTORY)
        .join(ACTIVE);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
        Ok(_) => {
            let id: String = read_json(&private_root(project)?.join(ACTIVE))?;
            Ok(Some(id))
        }
    }
}
/// All ordinary project writers call this through ensure_editable, including after async work.
pub(super) fn require_no_candidate(project: &OpenProject) -> Result<(), CreationError> {
    if project.merge_active || active_id(project)?.is_some() {
        Err(invalid(
            "A merge candidate owns this project. Finish or cancel the merge first.",
        ))
    } else {
        Ok(())
    }
}
fn repository(project: &OpenProject) -> Result<Repository, CreationError> {
    local_git::write_boundary(&project.root, false)?
        .ok_or_else(|| invalid("Save a project version before merging"))
}
fn private_repository(project: &OpenProject, record: &Record) -> Result<Repository, CreationError> {
    let path = operation_path(project, &record.id)?.join("repository");
    let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
    if !metadata.is_dir() || metadata.is_symlink() {
        return Err(invalid("Invalid private merge repository"));
    }
    let mut count = 0;
    for entry in ["objects", "refs", "config", "HEAD", "packed-refs", "info"] {
        local_git::metadata_boundary(&path.join(entry), 0, &mut count)?;
    }
    for entry in [
        "commondir",
        "objects/info/alternates",
        "info/grafts",
        "shallow",
    ] {
        if fs::symlink_metadata(path.join(entry)).is_ok() {
            return Err(invalid("Unsupported private merge repository metadata"));
        }
    }
    let repo = Repository::open_bare(&path).map_err(git)?;
    if !repo.is_bare() || fs::canonicalize(repo.path()).map_err(io_error)? != path {
        return Err(invalid("The private merge repository moved"));
    }
    local_git::local_config(&repo)?;
    Ok(repo)
}
fn valid_path(path: &str) -> Result<(), CreationError> {
    text_creation::admitted_destination(path)?;
    if path.split('/').count() > MAX_DEPTH
        || git_restore::checkout_protection(path).is_some()
        || local_git::excluded(path, 0).is_some_and(|reason| reason != GitExclusion::LargeMedia)
        || path.split('/').any(|name| {
            matches!(
                git_restore::checkout_name_key(name).as_str(),
                ".git" | ".gitattributes" | ".gitmodules" | "." | ".."
            )
        })
    {
        return Err(invalid(format!(
            "This merge path requires an external Git tool: {path}"
        )));
    }
    Ok(())
}
fn blob(repo: &Repository, entry: &Entry) -> Result<Vec<u8>, CreationError> {
    let id = parse(&entry.oid)?;
    let odb = repo.odb().map_err(git)?;
    let (size, kind) = odb.read_header(id).map_err(git)?;
    if kind != ObjectType::Blob || size as u64 > local_git::GIT_FILE_LIMIT {
        return Err(invalid("Merge blob exceeds supported limits"));
    }
    let object = odb.read(id).map_err(git)?;
    if Oid::hash_object(ObjectType::Blob, object.data()).map_err(git)? != id {
        return Err(conflict("A fixed merge object was modified or corrupted"));
    }
    Ok(object.data().to_vec())
}
fn entry_version(entry: Option<&Entry>) -> String {
    entry.map_or_else(
        || "missing".into(),
        |entry| format!("{}:{}", entry.oid, entry.mode),
    )
}
fn kind(path: &str, bytes: Option<&[u8]>) -> GitMergeFileKind {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        GitMergeFileKind::Image
    } else if materials::audio_format(path).is_some() {
        GitMergeFileKind::Audio
    } else if bytes.is_some_and(|bytes| {
        bytes.len() <= TEXT_MAX_BYTES as usize
            && !bytes.contains(&0)
            && std::str::from_utf8(bytes).is_ok()
    }) {
        GitMergeFileKind::Text
    } else {
        GitMergeFileKind::Binary
    }
}
fn inventory(repo: &Repository, tree: Oid) -> Result<Entries, CreationError> {
    let mut entries = Entries::new();
    let mut pending = vec![(tree, String::new(), 0)];
    let mut total = 0u64;
    let mut keys = BTreeSet::new();
    while let Some((id, prefix, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err(invalid("Merge tree is too deep"));
        }
        let tree = repo.find_tree(id).map_err(git)?;
        for item in tree.iter() {
            let name = item.name().map_err(git)?;
            if name.contains(['\\', '/']) {
                return Err(invalid("Unsupported merge path"));
            }
            let path = format!("{prefix}{name}");
            valid_path(&path)?;
            if !keys.insert(git_restore::checkout_name_key(&path)) {
                return Err(invalid("Merge paths collide on this filesystem"));
            }
            match item.kind() {
                Some(ObjectType::Tree) => pending.push((item.id(), format!("{path}/"), depth + 1)),
                Some(ObjectType::Blob) if matches!(item.filemode(), 0o100644 | 0o100755) => {
                    let (size, _) = repo
                        .odb()
                        .map_err(git)?
                        .read_header(item.id())
                        .map_err(git)?;
                    total += size as u64;
                    if size as u64 > local_git::GIT_FILE_LIMIT
                        || total > local_git::GIT_TOTAL_LIMIT
                        || entries.len() >= MAX_ENTRIES
                    {
                        return Err(invalid("Merge tree exceeds supported limits"));
                    }
                    entries.insert(
                        path,
                        Entry {
                            oid: item.id().to_string(),
                            mode: item.filemode() as u32,
                        },
                    );
                }
                _ => {
                    return Err(invalid(
                        "Symbolic links and submodules require an external Git tool",
                    ))
                }
            }
        }
    }
    Ok(entries)
}
fn tree(repo: &Repository, entries: &Entries) -> Result<Oid, CreationError> {
    let mut nodes = BTreeMap::<String, (String, bool)>::new();
    let mut total = 0u64;
    for (path, entry) in entries {
        valid_path(path)?;
        if !matches!(entry.mode, 0o100644 | 0o100755) {
            return Err(invalid("Unsupported merge result mode"));
        }
        let (size, kind) = repo
            .odb()
            .map_err(git)?
            .read_header(parse(&entry.oid)?)
            .map_err(git)?;
        total = total
            .checked_add(size as u64)
            .ok_or_else(|| invalid("Merge result is too large"))?;
        if kind != ObjectType::Blob
            || size as u64 > local_git::GIT_FILE_LIMIT
            || total > local_git::GIT_TOTAL_LIMIT
        {
            return Err(invalid("Merge result exceeds supported limits"));
        }
        let components = path.split('/').collect::<Vec<_>>();
        let mut prefix = String::new();
        for (position, component) in components.iter().enumerate() {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(component);
            let directory = position + 1 < components.len();
            let key = git_restore::checkout_name_key(&prefix);
            if let Some((previous, previous_directory)) = nodes.get(&key) {
                if previous != &prefix || *previous_directory != directory {
                    return Err(invalid("Merge result paths collide on this filesystem"));
                }
            } else {
                nodes.insert(key, (prefix.clone(), directory));
            }
            if nodes.len() > MAX_ENTRIES {
                return Err(invalid("Merge result exceeds 4096 entries"));
            }
        }
    }
    let mut index = git2::Index::new().map_err(git)?;
    for (path, entry) in entries {
        valid_path(path)?;
        index
            .add(&git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: entry.mode,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: parse(&entry.oid)?,
                flags: 0,
                flags_extended: 0,
                path: path.as_bytes().to_vec(),
            })
            .map_err(git)?;
    }
    index.write_tree_to(repo).map_err(git)
}
fn validate_transition(before: &Entries, after: &Entries) -> Result<(), CreationError> {
    let mut nodes = BTreeMap::<String, (String, bool)>::new();
    for path in before.keys().chain(after.keys()) {
        let components = path.split('/').collect::<Vec<_>>();
        let mut prefix = String::new();
        for (position, component) in components.iter().enumerate() {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(component);
            let directory = position + 1 < components.len();
            let key = git_restore::checkout_name_key(&prefix);
            if let Some((old, old_directory)) = nodes.get(&key) {
                if old != &prefix || *old_directory != directory {
                    return Err(invalid("Path case changes and file/directory replacements require an external Git tool"));
                }
            } else {
                nodes.insert(key, (prefix.clone(), directory));
            }
        }
    }
    Ok(())
}
fn changed_paths(before: &Entries, after: &Entries) -> Vec<String> {
    before
        .keys()
        .chain(after.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .cloned()
        .collect()
}
fn dto(project: &OpenProject, record: &Record) -> Result<GitMergeCandidate, CreationError> {
    let repo = private_repository(project, record);
    let mut storage_issue=repo.as_ref().err().map(|_|"Private merge files are unavailable; discard this candidate or continue publication recovery.".to_owned());
    let mut paths = changed_paths(&record.current, &record.entries)
        .into_iter()
        .collect::<BTreeSet<_>>();
    for (path, conflict) in &record.conflicts {
        if !conflict.resolved {
            paths.insert(path.clone());
        }
    }
    let files = paths
        .into_iter()
        .map(|path| {
            let entry = record
                .entries
                .get(&path)
                .or_else(|| record.current.get(&path))
                .or_else(|| record.incoming.get(&path));
            let bytes = match (repo.as_ref().ok(),entry) { (Some(repo),Some(entry))=>match blob(repo,entry){Ok(bytes)=>Some(bytes),Err(_)=>{storage_issue=Some("Private merge files are unavailable; discard this candidate or continue publication recovery.".into());None}}, _=>None };
            GitMergeFile {
                status: if !record.entries.contains_key(&path) {
                    "D"
                } else if !record.current.contains_key(&path) {
                    "A"
                } else {
                    "M"
                }
                .into(),
                kind: kind(&path, bytes.as_deref()),
                conflict: record.conflicts.get(&path).map(|conflict| conflict.kind),
                resolved: record
                    .conflicts
                    .get(&path)
                    .is_none_or(|conflict| conflict.resolved),
                version: entry_version(record.entries.get(&path)),
                current: record.current.contains_key(&path),
                incoming: record.incoming.contains_key(&path),
                path,
            }
        })
        .collect();
    let phase = if storage_issue.is_some() && record.phase != GitMergePhase::Completed {
        if record.publication.is_some() {
            GitMergePhase::Recovery
        } else {
            GitMergePhase::Stale
        }
    } else {
        record.phase
    };
    Ok(GitMergeCandidate {
        id: record.id.clone(),
        revision: record.revision,
        relation: record.relation,
        phase,
        source: record.source.clone(),
        target: record.target.clone(),
        base: record.base.clone(),
        branch: if record.phase == GitMergePhase::Completed {
            record
                .publication
                .as_ref()
                .map(|publication| publication.branch.clone())
                .or_else(|| record.branch.clone())
        } else {
            record.branch.clone()
        },
        name: record.name.clone(),
        unresolved: record
            .conflicts
            .values()
            .filter(|conflict| !conflict.resolved)
            .count() as u32,
        files,
        result: record
            .publication
            .as_ref()
            .map(|publication| publication.result.clone()),
        detail: storage_issue.clone().or_else(|| record.detail.clone()),
        assistant_owner: record.owner.clone(),
        can_undo: storage_issue.is_none() && record.checkpoint.is_some() && record.owner.is_none(),
    })
}

pub(super) fn has_candidate(project: &OpenProject) -> Result<bool, CreationError> {
    Ok(active_id(project)?.is_some())
}
pub(super) fn require_no_candidate_at_root(root: &Path) -> Result<(), CreationError> {
    let path = root.join(crate::creation_data::DIRECTORY);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    if !metadata.is_dir() || metadata.is_symlink() {
        return Err(invalid(
            "Private creator data cannot be trusted for merge ownership",
        ));
    }
    let directory = File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(io_error)?;
    let name = CString::new(ACTIVE).expect("literal");
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(io_error(error))
        };
    }
    let _held = unsafe { File::from_raw_fd(fd) };
    Err(invalid("A merge candidate owns this project; finish or cancel it before starting the actual project"))
}

pub(super) fn before_project_change(
    project: &OpenProject,
) -> Result<Option<String>, CreationError> {
    let Some(id) = active_id(project)? else {
        return Ok(None);
    };
    let mut record = load(project, &id)?;
    if record.owner.is_some() {
        return Err(invalid("Stop the merge assistant before changing projects"));
    }
    if record.phase == GitMergePhase::Active {
        record.phase = GitMergePhase::Paused;
        save(project, &record)?;
    }
    Ok(Some(id))
}
/// Inspect bounded PCM WAV metadata without transporting or playing audio bytes.
fn wav_metadata(bytes: &[u8]) -> Option<(u32, u32, u32, Vec<f32>)> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    let mut format = None;
    let mut data = None;
    while offset.checked_add(8)? <= bytes.len() {
        let length =
            u32::from_le_bytes(bytes.get(offset + 4..offset + 8)?.try_into().ok()?) as usize;
        let start = offset + 8;
        let end = start.checked_add(length)?;
        if end > bytes.len() {
            return None;
        }
        match bytes.get(offset..offset + 4)? {
            b"fmt " if length >= 16 => {
                let raw = bytes.get(start..end)?;
                let tag = u16::from_le_bytes(raw.get(..2)?.try_into().ok()?);
                let channels = u16::from_le_bytes(raw.get(2..4)?.try_into().ok()?) as u32;
                let sample_rate = u32::from_le_bytes(raw.get(4..8)?.try_into().ok()?);
                let align = u16::from_le_bytes(raw.get(12..14)?.try_into().ok()?) as u32;
                let bits = u16::from_le_bytes(raw.get(14..16)?.try_into().ok()?);
                if tag != 1
                    || channels == 0
                    || channels > 32
                    || !(8_000..=384_000).contains(&sample_rate)
                    || bits != 16
                    || align != channels * 2
                {
                    return None;
                }
                format = Some((channels, sample_rate, align));
            }
            b"data" => data = Some(bytes.get(start..end)?),
            _ => {}
        }
        offset = end.checked_add(length % 2)?;
    }
    let (channels, sample_rate, align) = format?;
    let data = data?;
    if data.is_empty() || data.len() % align as usize != 0 {
        return None;
    }
    let frames = data.len() / align as usize;
    let duration_ms = u32::try_from((frames as u64 * 1000) / u64::from(sample_rate)).ok()?;
    let sample_count = data.len() / 2;
    let waveform = (0..72)
        .map(|bin| {
            let start = bin * sample_count / 72;
            let end = ((bin + 1) * sample_count / 72)
                .max(start + 1)
                .min(sample_count);
            (start..end)
                .map(|index| {
                    f32::from(i16::from_le_bytes([data[index * 2], data[index * 2 + 1]])) / 32768.0
                })
                .map(f32::abs)
                .fold(0.0_f32, f32::max)
        })
        .collect();
    Some((duration_ms, sample_rate, channels, waveform))
}

fn sync_private_repository(repo: &Repository) -> Result<(), CreationError> {
    let objects = repo.path().join("objects");
    let mut pending = vec![objects];
    let mut directories = Vec::new();
    while let Some(path) = pending.pop() {
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.is_symlink() {
            return Err(invalid("Merge object directories cannot be symbolic"));
        }
        if metadata.is_dir() {
            for entry in fs::read_dir(&path).map_err(io_error)? {
                let entry = entry.map_err(io_error)?;
                let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
                if metadata.is_symlink() {
                    return Err(invalid("Merge objects cannot be symbolic"));
                }
                if metadata.is_dir() {
                    pending.push(entry.path());
                } else if !metadata.is_file() {
                    return Err(invalid("Merge objects must be regular files"));
                }
            }
            directories.push(path);
        }
    }
    for directory in directories.into_iter().rev() {
        File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(directory)
            .map_err(io_error)?
            .sync_all()
            .map_err(io_error)?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GitMergeAudioGrant {
    id: String,
    revision: u32,
    path: String,
    side: GitMergeSide,
    version: String,
}

pub(super) fn pause_for_exit(project: &OpenProject) -> Result<Option<String>, CreationError> {
    blank::check_directory_identity(&project.root, &project.directory)?;
    let Some(id) = active_id(project)? else {
        return Ok(None);
    };
    let mut record = load(project, &id)?;
    record.owner = None;
    record.pending_round = None;
    if record.phase == GitMergePhase::Active {
        record.phase = GitMergePhase::Paused;
    } else if record.phase == GitMergePhase::Publishing {
        record.phase = GitMergePhase::Recovery;
    }
    save(project, &record)?;
    Ok(Some(id))
}
