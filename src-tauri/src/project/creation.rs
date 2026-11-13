//! Trusted project identities and bounded file reading for the creation workspace.

use base64::Engine as _;
use serde::Serialize;
use specta::Type;
use std::collections::BTreeMap;
use std::ffi::{CStr, CString, OsString};
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

mod assistant;
mod assistant_resume;
pub use assistant_resume::*;
mod assistant_tasks;
pub use assistant_tasks::*;
#[cfg(test)]
mod assistant_tasks_tests;
mod baselines;
pub use baselines::{HandoffBaselineCatalog, HandoffComparison};
#[cfg(test)]
mod baselines_tests;
mod blank;
#[cfg(feature = "blank-template-export")]
pub use blank::github_template::export as export_blank_template;
#[cfg(test)]
mod blank_github_tests;
pub use assistant::{
    AssistantProjectOverview, AssistantProjectPage, AssistantProjectRead, AssistantProjectSearch,
    AssistantProjectSnapshot,
};
#[cfg(test)]
mod assistant_tests;
#[cfg(test)]
mod blank_input;
#[cfg(test)]
mod blank_players;
#[cfg(test)]
mod blank_recording;
#[cfg(test)]
mod blank_runtime;
mod changes;
#[cfg(test)]
mod changes_tests;
#[cfg(test)]
mod classic;
#[cfg(test)]
mod classic_tests;
mod compile;
#[cfg(test)]
mod compile_tests;
mod git;
mod git_comparison;
mod git_history;
mod git_read;
pub(crate) mod github_git;
mod read_root;
pub(crate) use git_read::{run_read, GitReadJob};
#[cfg(test)]
mod git_read_comparison_tests;
#[cfg(test)]
mod git_read_tests;
pub use git_comparison::*;
#[cfg(test)]
mod git_comparison_tests;
mod git_restore;
mod git_version_names;
#[cfg(test)]
mod git_version_names_tests;
mod git_versions;
pub use git_versions::*;
#[cfg(test)]
mod git_versions_tests;
mod local_git;
mod native_git;
mod saved_text;
#[cfg(test)]
mod saved_text_tests;
mod text_creation;
#[cfg(test)]
mod text_creation_tests;
mod text_publication;
pub use git_history::*;
pub use git_restore::*;
#[cfg(test)]
mod local_git_tests;
pub use local_git::*;
mod handoff;
mod handoff_operation;
#[cfg(test)]
mod handoff_updates_tests;
pub use git::{CreationGitDiff, CreationGitStatus, GitDiffLayer, GitReader};
pub use handoff::{HandoffReceipt, HandoffReview};
pub use handoff_operation::{HandoffOperationProgress, HandoffOperations};
#[cfg(test)]
mod git_tests;
mod libraries;
mod materials;
pub use materials::*;
#[cfg(test)]
mod libraries_tests;
#[cfg(test)]
mod materials_tests;
mod modules;
mod parameters;
pub use parameters::*;
#[cfg(test)]
mod microphone_chat_tests;
#[cfg(test)]
mod modules_motion_tests;
#[cfg(test)]
mod modules_tests;
#[cfg(test)]
mod parameters_tests;
pub use blank::NewProjectOptions;
pub use changes::CreationFileChange;
pub use compile::{SynthdefCompileReport, SynthdefCompiler};
pub use libraries::{CreationLibraryAdoption, CreationLibraryCatalog, CreationLibraryResult};
pub use modules::{CreationModuleAddResult, CreationModuleCatalog};

pub const TEXT_MAX_BYTES: u64 = 1024 * 1024;
pub const IMAGE_MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CreationErrorCode {
    Missing,
    Cancelled,
    Permission,
    InvalidUtf8,
    TooLarge,
    InvalidIdentity,
    PathEscape,
    InvalidProject,
    ManifestInvalid,
    TestValidation,
    RuntimeBusy,
    TestStartup,
    VersionConflict,
    GitHubNetwork,
    TargetExists,
    SupercolliderMissing,
    ExternalOpen,
    Io,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationError {
    pub code: CreationErrorCode,
    pub detail: String,
}

impl CreationError {
    pub fn new(code: CreationErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

fn io_error(error: io::Error) -> CreationError {
    let code = match error.kind() {
        io::ErrorKind::NotFound => CreationErrorCode::Missing,
        io::ErrorKind::PermissionDenied => CreationErrorCode::Permission,
        _ => CreationErrorCode::Io,
    };
    CreationError::new(code, error.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CreationSource {
    Folder,
    Bundle,
    Utility,
    ReadOnlyFolder,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationProject {
    pub identity: String,
    pub root: String,
    pub name: String,
    pub source: CreationSource,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationWorkspace {
    pub project: CreationProject,
    pub files: Vec<CreationFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_git_head: Option<String>,
}

/// Supplied only by the command adapter's App paths and embedded registry.
#[derive(Default)]
pub struct Protection {
    pub bundles: Vec<PathBuf>,
    pub utilities: Vec<PathBuf>,
}

impl Protection {
    pub(crate) fn source(&self, root: &Path) -> CreationSource {
        let contains = |paths: &[PathBuf]| {
            paths.iter().any(|path| {
                root.starts_with(path)
                    || fs::canonicalize(path)
                        .is_ok_and(|path| root.starts_with(&path) || path.starts_with(root))
            })
        };
        if contains(&self.bundles) {
            CreationSource::Bundle
        } else if contains(&self.utilities) {
            CreationSource::Utility
        } else {
            let writable = CString::new(root.as_os_str().as_encoded_bytes())
                .is_ok_and(|path| unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 });
            if writable {
                CreationSource::Folder
            } else {
                CreationSource::ReadOnlyFolder
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CreationFileKind {
    Text,
    Image,
    Binary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CreationCategory {
    Audio,
    Pages,
    Modules,
    Assets,
    System,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationFile {
    pub path: String,
    pub size: f64,
    pub kind: CreationFileKind,
    pub category: CreationCategory,
}

#[derive(Debug, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CreationContent {
    /// `version` fingerprints the bytes read from disk; saves must echo it
    /// back so the backend can detect external modification (#154).
    Text {
        text: String,
        version: String,
    },
    Image {
        url: String,
    },
    Binary,
}

struct OpenProject {
    descriptor: CreationProject,
    directory: File,
    root: PathBuf,
    watch: BTreeMap<String, String>,
    pending: BTreeMap<String, u32>,
    revision: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationChanges {
    pub files: Vec<CreationFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directories: Option<Vec<String>>,
    pub changed: Vec<String>,
    pub revision: u32,
    /// Per-path observations stay stable when an unacknowledged batch is replayed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_revisions: Option<BTreeMap<String, u32>>,
}

/// One active identity; a successful replacement revokes the old capability.
#[derive(Default)]
pub struct CreationAccess {
    assistant_grant: Option<(String, String, AssistantMode)>,
    assistant_operation: Option<AssistantOperation>,
    project: Option<OpenProject>,
    prepared: Option<OpenProject>,
    generation: u64,
    last_change: Option<(String, CreationFileChange)>,
    change_sequence: u64,
    git_preview: Option<GitPreviewSession>,
    git_comparison: Option<git_comparison::GitComparisonSession>,
    git_comparison_epoch: u64,
    git_restore_preview: Option<git_restore::GitRestoreSession>,
    git_switch_preview: Option<git_versions::GitSwitchSession>,
    git_ended_tasks: std::collections::BTreeSet<String>,
    handoff_review: Option<HandoffReview>,
    handoff_receipt: Option<(String, HandoffReceipt)>,
}

impl CreationAccess {
    pub fn descriptor(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<CreationProject, CreationError> {
        Ok(self.current(identity, protection)?.descriptor.clone())
    }

    pub fn manifest(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<super::manifest::Manifest, CreationError> {
        match self.read(identity, "manifest.json", protection)? {
            CreationContent::Text { text, .. } => super::manifest::parse_manifest(&text)
                .map_err(|detail| CreationError::new(CreationErrorCode::InvalidProject, detail)),
            _ => Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Manifest must be text",
            )),
        }
    }

    pub fn open(
        &mut self,
        path: &Path,
        protection: &Protection,
    ) -> Result<CreationWorkspace, CreationError> {
        let workspace = self.prepare(path, protection)?;
        self.commit(&workspace.project.identity, protection)?;
        Ok(workspace)
    }

    pub fn prepare(
        &mut self,
        path: &Path,
        protection: &Protection,
    ) -> Result<CreationWorkspace, CreationError> {
        let root = fs::canonicalize(path).map_err(io_error)?;
        let directory = File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&root)
            .map_err(io_error)?;
        let candidate = OpenProject {
            descriptor: CreationProject {
                identity: (self.generation + 1).to_string(),
                root: root.to_string_lossy().into_owned(),
                name: String::new(),
                source: protection.source(&root),
            },
            directory,
            root,
            watch: BTreeMap::new(),
            pending: BTreeMap::new(),
            revision: 0,
        };
        let manifest_file = candidate.file("manifest.json")?;
        let raw = bounded_read(manifest_file, TEXT_MAX_BYTES)?;
        let raw = String::from_utf8(raw)
            .map_err(|e| CreationError::new(CreationErrorCode::InvalidUtf8, e.to_string()))?;
        let manifest = super::manifest::parse_manifest(&raw)
            .map_err(|e| CreationError::new(CreationErrorCode::InvalidProject, e))?;
        if !candidate
            .file(&manifest.score_server.entry)?
            .metadata()
            .map_err(io_error)?
            .is_file()
        {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "scoreServer.entry must be a file",
            ));
        }
        if !candidate
            .file(&manifest.score_server.working_directory)?
            .metadata()
            .map_err(io_error)?
            .is_dir()
        {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "scoreServer.workingDirectory must be a directory",
            ));
        }
        let mut candidate = candidate;
        candidate.descriptor.name = manifest.name;
        let mut files = Vec::new();
        let mut directories = Vec::new();
        candidate.walk_entries(
            Path::new(""),
            0,
            &mut 0,
            &mut Vec::new(),
            &mut files,
            &mut directories,
        )?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        candidate.watch = candidate.watch_versions(&files)?;
        self.generation += 1;
        let descriptor = candidate.descriptor.clone();
        self.prepared = Some(candidate);
        Ok(CreationWorkspace {
            project: descriptor,
            files,
            directories: Some(directories),
            initial_git_head: None,
        })
    }

    pub fn prepared_project(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<CreationProject, CreationError> {
        let candidate = self
            .prepared
            .as_ref()
            .filter(|p| p.descriptor.identity == identity)
            .ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::InvalidIdentity,
                    "The prepared project expired",
                )
            })?;
        validate_identity(candidate, protection)?;
        Ok(candidate.descriptor.clone())
    }

    pub fn commit(&mut self, identity: &str, protection: &Protection) -> Result<(), CreationError> {
        self.prepared_project(identity, protection)?;
        self.activate_prepared(identity)
    }

    /// Called only after validation under the creation access lock. No disk
    /// I/O belongs inside the runtime-generation critical section.
    pub(crate) fn activate_prepared(&mut self, identity: &str) -> Result<(), CreationError> {
        if !self
            .prepared
            .as_ref()
            .is_some_and(|project| project.descriptor.identity == identity)
        {
            return Err(CreationError::new(
                CreationErrorCode::InvalidIdentity,
                "The prepared project expired",
            ));
        }
        self.cancel_assistant_operations(None);
        self.project = self.prepared.take();
        self.last_change = None;
        Ok(())
    }

    pub fn close(&mut self, identity: &str) {
        self.cancel_assistant_operations(Some(identity));
        if self
            .prepared
            .as_ref()
            .is_some_and(|p| p.descriptor.identity == identity)
        {
            self.prepared = None;
        }
        if self
            .project
            .as_ref()
            .is_some_and(|p| p.descriptor.identity == identity)
        {
            self.project = None;
            self.last_change = None;
        }
    }

    fn current(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<&OpenProject, CreationError> {
        let invalid = || {
            CreationError::new(
                CreationErrorCode::InvalidIdentity,
                "Reopen the project folder",
            )
        };
        let project = self
            .project
            .as_ref()
            .filter(|p| p.descriptor.identity == identity)
            .ok_or_else(invalid)?;
        validate_identity(project, protection)?;
        Ok(project)
    }

    /// Open creator records through the held root, never through a path that
    /// could be replaced after capability validation.
    pub fn creation_data_directory(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<File, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        crate::creation_data::open(&project.directory).map_err(io_error)
    }

    pub fn list(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<Vec<CreationFile>, CreationError> {
        let project = self.current(identity, protection)?;
        let mut files = Vec::new();
        project.walk(Path::new(""), 0, &mut 0, &mut Vec::new(), &mut files)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    }

    /// A bounded polling watcher uses the same held-root capability as reads.
    /// Changes remain pending until the caller acknowledges their revision.
    pub fn poll(
        &mut self,
        identity: &str,
        since: u32,
        protection: &Protection,
    ) -> Result<CreationChanges, CreationError> {
        let project = self.current(identity, protection)?;
        let mut files = Vec::new();
        let mut directories = Vec::new();
        project.walk_entries(
            Path::new(""),
            0,
            &mut 0,
            &mut Vec::new(),
            &mut files,
            &mut directories,
        )?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        directories.sort();
        let versions = self.current(identity, protection)?.watch_versions(&files)?;
        let project = self.project.as_mut().expect("identity validated");
        let mut changed: Vec<String> = versions
            .iter()
            .filter(|(path, version)| project.watch.get(*path) != Some(*version))
            .map(|(path, _)| path.clone())
            .collect();
        changed.extend(
            project
                .watch
                .keys()
                .filter(|path| !versions.contains_key(*path))
                .cloned(),
        );
        project.pending.retain(|_, revision| *revision > since);
        if !changed.is_empty() {
            project.revision += 1;
            for path in changed {
                project.pending.insert(path, project.revision);
            }
        }
        project.watch = versions;
        Ok(CreationChanges {
            files,
            directories: Some(directories),
            changed: project.pending.keys().cloned().collect(),
            revision: project.revision,
            change_revisions: Some(project.pending.clone()),
        })
    }

    pub fn read(
        &self,
        identity: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<CreationContent, CreationError> {
        self.current(identity, protection)?.read_root().read(path)
    }

    pub fn drag_target(
        &self,
        identity: &str,
        path: &str,
        protection: &Protection,
    ) -> Result<PathBuf, CreationError> {
        let project = self.current(identity, protection)?;
        let file = project.file(path)?;
        if !file.metadata().map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Only saved regular files can be dragged",
            ));
        }
        project.resolve(path)
    }

    /// Keep the current workspace capability held until the native open is
    /// dispatched. The callback accepts only this verified saved SCD path.
    pub fn open_scd<T>(
        &self,
        identity: &str,
        path: &str,
        protection: &Protection,
        dispatch: impl FnOnce(&Path) -> Result<T, CreationError>,
    ) -> Result<T, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let is_scd = |path: &Path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("scd"))
        };
        let target = project.resolve(path)?;
        if !is_scd(Path::new(path)) || !is_scd(&target) {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Select a saved SCD source file",
            ));
        }
        let held = project
            .resolved_file(&target, path)?
            .metadata()
            .map_err(io_error)?;
        if !held.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Select a saved regular SCD source file",
            ));
        }
        self.current(identity, protection)?;
        let disk = fs::metadata(&target).map_err(io_error)?;
        if disk.dev() != held.dev() || disk.ino() != held.ino() {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "The source file changed before opening; retry",
            ));
        }
        dispatch(&target)
    }

    pub fn finder_target(
        &self,
        identity: &str,
        path: Option<&str>,
        protection: &Protection,
    ) -> Result<PathBuf, CreationError> {
        let project = self.current(identity, protection)?;
        let path = path.unwrap_or(".");
        project.file(path)?;
        project.resolve(path)
    }

    /// Atomically writes `text` to `path`, refusing when the disk version no
    /// longer matches the one the editor read (#154). The check happens at
    /// save time on actual bytes, never through watcher notifications.
    pub fn save(
        &mut self,
        identity: &str,
        path: &str,
        text: &str,
        expected_version: &str,
        protection: &Protection,
    ) -> Result<String, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        if file_kind(path) != CreationFileKind::Text {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Only text files can be edited",
            ));
        }
        if text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                format!("Limit: {TEXT_MAX_BYTES} bytes"),
            ));
        }
        // #158: the manifest form and the text editor share this one write
        // path, so schema problems are refused — before the version check —
        // with the field-specific reason and never touch disk. Validation
        // deliberately stops at parse_manifest: missing SynthDef artifacts
        // belong to the launch and bundle gates, so a legal declaration can
        // be saved before it is compiled.
        if is_root_manifest(path) {
            if let Err(detail) = crate::project::manifest::parse_manifest(text) {
                return Err(CreationError::new(
                    CreationErrorCode::ManifestInvalid,
                    detail,
                ));
            }
        }
        saved_text::publish(project, path, text, expected_version, protection)?;
        self.last_change = None;
        Ok(file_version(text.as_bytes()))
    }

    /// Moves a project file to `next_path`. Existing targets are never
    /// replaced and source references are left untouched for external
    /// agents to adjust (#154).
    pub fn rename(
        &mut self,
        identity: &str,
        path: &str,
        next_path: &str,
        draft_paths: &[String],
        protection: &Protection,
    ) -> Result<String, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let source = project.resolve(path)?;
        if !fs::metadata(&source).map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Rename selects a regular file",
            ));
        }
        if draft_paths.len() > MAX_ENTRIES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Draft path list exceeds 4096 entries",
            ));
        }
        let target = project.destination(next_path)?;
        for draft_path in draft_paths {
            match project.destination(draft_path) {
                Ok(draft_target) if draft_target == target => {
                    return Err(CreationError::new(
                        CreationErrorCode::TargetExists,
                        next_path,
                    ));
                }
                Ok(_) => {}
                Err(error) if error.code == CreationErrorCode::Missing => {}
                Err(error) => return Err(error),
            }
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                return Err(CreationError::new(
                    CreationErrorCode::TargetExists,
                    next_path,
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        fs::rename(&source, &target).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                CreationError::new(CreationErrorCode::TargetExists, next_path)
            } else {
                io_error(error)
            }
        })?;
        let renamed = target
            .strip_prefix(&project.root)
            .expect("containment checked")
            .to_string_lossy()
            .into_owned();
        self.last_change = None;
        Ok(renamed)
    }
}

fn ensure_editable(project: &OpenProject) -> Result<(), CreationError> {
    if project.descriptor.source != CreationSource::Folder {
        Err(CreationError::new(
            CreationErrorCode::Permission,
            "This project source is read-only",
        ))
    } else {
        Ok(())
    }
}

/// True only for the project root's manifest — a `manifest.json` inside a
/// subdirectory is an ordinary text file whose saving carries no contract.
fn is_root_manifest(path: &str) -> bool {
    let mut components = Path::new(path)
        .components()
        .filter(|component| !matches!(component, Component::CurDir));
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(name)), None) if name == std::ffi::OsStr::new("manifest.json")
    )
}

/// Replaces `target` atomically: a fresh temp file in the same directory is
/// fully written and permission-matched before one rename swaps it in, so a
/// failed save never leaves a half-written file behind.
fn atomic_write(target: &Path, bytes: &[u8], mode: fs::Permissions) -> Result<(), CreationError> {
    // Private journal/baseline records share only publication mechanics, not
    // the workspace's saved-text authority or version policy.
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let directory = File::open(parent).map_err(io_error)?;
    let name = target.file_name().ok_or_else(|| {
        CreationError::new(CreationErrorCode::InvalidProject, "Missing file name")
    })?;
    let name = CString::new(name.as_bytes())
        .map_err(|_| CreationError::new(CreationErrorCode::InvalidProject, "Invalid file name"))?;
    let receipt = text_publication::publish_text_at(
        text_publication::TextPublication {
            directory: &directory,
            name: &name,
            bytes,
            policy: text_publication::PublishPolicy::Replace { permissions: mode },
        },
        || Ok(()),
    )?;
    debug_assert!(matches!(
        receipt.state,
        text_publication::PublicationState::Installed
    ));
    Ok(())
}

/// A content fingerprint binding a draft to the exact bytes it was read
/// from; equal content keeps the version stable so idempotent external
/// writes do not read as conflicts.
fn file_version(bytes: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let hash = hasher.finish();
    let len = bytes.len();
    format!("{len:x}-{hash:x}")
}

fn validate_identity(project: &OpenProject, protection: &Protection) -> Result<(), CreationError> {
    let invalid = || {
        CreationError::new(
            CreationErrorCode::InvalidIdentity,
            "Reopen the project folder",
        )
    };
    let disk = fs::metadata(&project.root).map_err(|_| invalid())?;
    let held = project.directory.metadata().map_err(io_error)?;
    if disk.dev() != held.dev()
        || disk.ino() != held.ino()
        || protection.source(&project.root) != project.descriptor.source
    {
        return Err(invalid());
    }
    Ok(())
}

impl OpenProject {
    fn destination(&self, path: &str) -> Result<PathBuf, CreationError> {
        let next = Path::new(path);
        if crate::creation_data::contains(next) {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "privateCreationData",
            ));
        }
        if next
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(CreationError::new(CreationErrorCode::PathEscape, path));
        }
        let name = next
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && *name != "." && *name != "..")
            .ok_or_else(|| {
                CreationError::new(CreationErrorCode::InvalidProject, "Enter a file name")
            })?;
        let parent = match next.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                self.resolve(&parent.to_string_lossy())?
            }
            _ => self.root.clone(),
        };
        if !fs::metadata(&parent).map_err(io_error)?.is_dir() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "The target folder must exist",
            ));
        }
        let target = parent.join(name);
        if !target.starts_with(&self.root) {
            return Err(CreationError::new(CreationErrorCode::PathEscape, path));
        }
        Ok(target)
    }

    fn watch_versions(
        &self,
        files: &[CreationFile],
    ) -> Result<BTreeMap<String, String>, CreationError> {
        files
            .iter()
            .map(|file| {
                let metadata = self.file(&file.path)?.metadata().map_err(io_error)?;
                // ctime also detects same-size writes and restored mtime; inode
                // detects atomic replacement. Never read/decode unbounded assets.
                let version = format!(
                    "{}:{}:{}:{}:{}:{}:{}",
                    metadata.dev(),
                    metadata.ino(),
                    metadata.len(),
                    metadata.mtime(),
                    metadata.mtime_nsec(),
                    metadata.ctime(),
                    metadata.ctime_nsec()
                );
                Ok((file.path.clone(), version))
            })
            .collect()
    }

    fn read_root(&self) -> read_root::RootAccess<'_> {
        read_root::RootAccess {
            root: &self.root,
            directory: &self.directory,
        }
    }

    fn resolve(&self, path: &str) -> Result<PathBuf, CreationError> {
        self.read_root().resolve(path)
    }

    fn file(&self, path: &str) -> Result<File, CreationError> {
        self.read_root().file(path)
    }

    fn resolved_file(&self, resolved: &Path, path: &str) -> Result<File, CreationError> {
        self.read_root().resolved_file(resolved, path)
    }

    fn walk(
        &self,
        relative: &Path,
        depth: usize,
        count: &mut usize,
        ancestors: &mut Vec<PathBuf>,
        files: &mut Vec<CreationFile>,
    ) -> Result<(), CreationError> {
        self.walk_entries(relative, depth, count, ancestors, files, &mut Vec::new())
    }

    fn walk_entries(
        &self,
        relative: &Path,
        depth: usize,
        count: &mut usize,
        ancestors: &mut Vec<PathBuf>,
        files: &mut Vec<CreationFile>,
        directories: &mut Vec<String>,
    ) -> Result<(), CreationError> {
        if depth > MAX_DEPTH {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "Directory depth exceeds 32",
            ));
        }
        let path = relative.to_string_lossy();
        let resolved = self.resolve(&path)?;
        if ancestors.contains(&resolved) {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "Directory symlink cycle",
            ));
        }
        ancestors.push(resolved);
        let directory = self.file(&path)?;
        for name in directory_names(directory)? {
            if name == ".git"
                || name == "node_modules"
                || crate::creation_data::contains(Path::new(&name))
            {
                continue;
            }
            // Crash-orphaned atomic-save temp files stay out of the tree;
            // only the exact save-temp prefix is hidden, not user files.
            if name.as_os_str().as_bytes().starts_with(b".pnds-save-") {
                continue;
            }
            *count += 1;
            if *count > MAX_ENTRIES {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "File list exceeds 4096 entries",
                ));
            }
            let child = relative.join(name);
            let path = child.to_str().ok_or_else(|| {
                CreationError::new(CreationErrorCode::InvalidUtf8, "File path is not UTF-8")
            })?;
            if fs::canonicalize(self.root.join(&child)).is_ok_and(|target| {
                target
                    .strip_prefix(&self.root)
                    .is_ok_and(crate::creation_data::contains)
            }) {
                continue;
            }
            let metadata = self.file(path)?.metadata().map_err(io_error)?;
            if metadata.is_dir() {
                directories.push(path.into());
                self.walk_entries(&child, depth + 1, count, ancestors, files, directories)?;
            } else if metadata.is_file() {
                files.push(CreationFile {
                    path: path.into(),
                    size: metadata.len() as f64,
                    kind: file_kind(path),
                    category: category(path),
                });
            }
        }
        ancestors.pop();
        Ok(())
    }
}

/// macOS does not expose directory contents through /dev/fd; fdopendir
/// enumerates the directory we already validated and opened instead.
fn directory_names(directory: File) -> Result<Vec<OsString>, CreationError> {
    struct Directory(*mut libc::DIR);
    impl Drop for Directory {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    let fd = directory.into_raw_fd();
    // SAFETY: fdopendir takes ownership only on success.
    let pointer = unsafe { libc::fdopendir(fd) };
    if pointer.is_null() {
        let error = io::Error::last_os_error();
        drop(unsafe { File::from_raw_fd(fd) });
        return Err(io_error(error));
    }
    let directory = Directory(pointer);
    let mut names = Vec::new();
    loop {
        #[cfg(target_os = "macos")]
        unsafe {
            *libc::__error() = 0;
        }
        #[cfg(target_os = "linux")]
        unsafe {
            *libc::__errno_location() = 0;
        }
        // SAFETY: the live DIR is used only by this call, and d_name is
        // copied before the next readdir can invalidate it.
        let entry = unsafe { libc::readdir(directory.0) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(0) {
                return Err(io_error(error));
            }
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if name.to_bytes() == b"." || name.to_bytes() == b".." {
            continue;
        }
        names.push(std::ffi::OsStr::from_bytes(name.to_bytes()).to_os_string());
        if names.len() > MAX_ENTRIES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "File list exceeds 4096 entries",
            ));
        }
    }
    Ok(names)
}

fn bounded_read(file: File, limit: u64) -> Result<Vec<u8>, CreationError> {
    let metadata: Metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(CreationError::new(
            CreationErrorCode::InvalidProject,
            "Select a regular file",
        ));
    }
    if metadata.len() > limit {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            format!("Limit: {limit} bytes"),
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            format!("Limit: {limit} bytes"),
        ));
    }
    Ok(bytes)
}

fn image_mime(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

fn file_kind(path: &str) -> CreationFileKind {
    if image_mime(path).is_some() {
        return CreationFileKind::Image;
    }
    let ext = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        ext.as_str(),
        "" | "js"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "jsx"
            | "json"
            | "md"
            | "txt"
            | "html"
            | "css"
            | "scd"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "svg"
            | "csv"
            | "sh"
            | "lock"
            | "gitignore"
    ) {
        CreationFileKind::Text
    } else {
        CreationFileKind::Binary
    }
}

fn category(path: &str) -> CreationCategory {
    if path.starts_with("audio/")
        || path.starts_with("supercollider/")
        || path.ends_with(".scd")
        || path.ends_with(".scsyndef")
    {
        CreationCategory::Audio
    } else if path.starts_with("modules/")
        || path.starts_with("shared/")
        || path.starts_with("lib/")
    {
        CreationCategory::Modules
    } else if file_kind(path) != CreationFileKind::Text {
        CreationCategory::Assets
    } else if path.starts_with("public/")
        || path.starts_with("performer/")
        || path.starts_with("monitor/")
    {
        CreationCategory::Pages
    } else {
        CreationCategory::System
    }
}

#[cfg(test)]
mod tests;
