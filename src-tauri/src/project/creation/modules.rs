//! Frozen offline files, exclusive directory publication, then an idempotent handoff.
use super::*;
use crate::project::handoff::HandoffTask;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const VERSION: &str = "0.1.0";
const RECORD: &CStr = c"pnds-module.json";
const LICENSE: (&str, &[u8]) = (
    "LICENSE.md",
    include_bytes!("../../../resources/modules/LICENSE.md"),
);

struct Module {
    id: &'static str,
    files: &'static [(&'static str, &'static [u8])],
}

macro_rules! asset {
    ($module:literal, $file:literal) => {
        (
            $file,
            include_bytes!(concat!("../../../resources/modules/", $module, "/", $file)).as_slice(),
        )
    };
}

const MODULES: &[Module] = &[
    Module {
        id: "qr",
        files: &[
            asset!("qr", "qr.js"),
            asset!("qr", "package.json"),
            asset!("qr", "README.md"),
            LICENSE,
        ],
    },
    Module {
        id: "players",
        files: &[
            asset!("players", "players.js"),
            asset!("players", "seats-store.js"),
            asset!("players", "protocol.js"),
            asset!("players", "client.js"),
            asset!("players", "package.json"),
            asset!("players", "README.md"),
            LICENSE,
        ],
    },
    Module {
        id: "theme-follow",
        files: &[
            asset!("theme-follow", "theme-follow.js"),
            asset!("theme-follow", "package.json"),
            asset!("theme-follow", "README.md"),
            LICENSE,
        ],
    },
    Module {
        id: "locale-follow",
        files: &[
            asset!("locale-follow", "locale-follow.js"),
            asset!("locale-follow", "package.json"),
            asset!("locale-follow", "README.md"),
            LICENSE,
        ],
    },
    Module {
        id: "monitor-state",
        files: &[
            asset!("monitor-state", "monitor-state.js"),
            asset!("monitor-state", "client.js"),
            asset!("monitor-state", "package.json"),
            asset!("monitor-state", "README.md"),
            LICENSE,
        ],
    },
];

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModuleSource {
    repository: String,
    revision: String,
    version: String,
}

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModuleState {
    Available,
    Added,
    NeedsHandoff,
    Conflict,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationModule {
    pub id: String,
    pub version: String,
    pub source: ModuleSource,
    pub files: Vec<String>,
    pub state: ModuleState,
    pub record_version: Option<String>,
    pub error: Option<CreationError>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationModuleCatalog {
    pub modules: Vec<CreationModule>,
    pub handoff_version: Option<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationModuleAddResult {
    pub files: Vec<String>,
    pub handoff_recorded: bool,
    pub already_added: bool,
    pub error: Option<CreationError>,
}

impl Module {
    fn directory(&self) -> CString {
        CString::new(format!("pnds-{}", self.id)).expect("fixed module ID")
    }
    fn files(&self) -> Vec<String> {
        let id = self.id;
        self.files
            .iter()
            .map(|(path, _)| format!("modules/pnds-{id}/{path}"))
            .chain(std::iter::once(format!(
                "modules/pnds-{id}/pnds-module.json"
            )))
            .collect()
    }
    fn task(&self) -> HandoffTask {
        let digest = format!(
            "{:x}",
            Sha256::digest(format!("pnds-module:{}:{VERSION}", self.id))
        );
        let id = format!(
            "{}-{}-{}-{}-{}",
            &digest[..8],
            &digest[8..12],
            &digest[12..16],
            &digest[16..20],
            &digest[20..32]
        );
        HandoffTask {
            id,
            intent: format!("Wire PNDS module {} / 接入 PNDS 模块 {} ({VERSION}). Read its README before choosing dependencies, routes, events and project-specific behavior. / 先阅读模块 README，再确认依赖、路由、事件与作品行为。", self.id, self.id),
            files: self.files(),
            acceptance: "Files have been added only. Wiring and validation are pending. Preserve project customizations; check dependencies explicitly, wire the server/pages and verify real runtime behavior, reconnect and cleanup. Record wiring and validation evidence separately. Do not treat file copying as a successful performance. / 仅加入文件，接线与验证待完成。保留作品定制，明确检查依赖，接入服务器和页面，验证真实运行、重连与清理，分别记录接线和验证证据；复制成功不代表演出验收通过。".into(),
            status: "pending".into(),
        }
    }
}

impl CreationAccess {
    pub fn module_catalog(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<CreationModuleCatalog, CreationError> {
        let project = self.current(identity, protection)?;
        let handoff = self.read_handoff(identity, protection)?;
        let modules = MODULES
            .iter()
            .map(|module| {
                let mut entry = CreationModule {
                    id: module.id.into(),
                    version: VERSION.into(),
                    source: source(),
                    files: module.files(),
                    state: ModuleState::Available,
                    record_version: None,
                    error: None,
                };
                match module_record(project, module) {
                    Ok(Some((record, version))) => {
                        entry.record_version = Some(version);
                        entry.state = if handoff
                            .text
                            .lines()
                            .any(|line| line == module.task().marker())
                        {
                            ModuleState::Added
                        } else {
                            ModuleState::NeedsHandoff
                        };
                        // An existing record establishes provenance, never wiring/validation.
                        if record["source"]["revision"] != source().revision
                            || record["version"] != VERSION
                            || record["id"] != module.id
                        {
                            entry.state = ModuleState::Conflict;
                            entry.error = Some(CreationError::new(
                                CreationErrorCode::TargetExists,
                                module.id,
                            ));
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        entry.state = ModuleState::Conflict;
                        entry.error = Some(error);
                    }
                }
                entry
            })
            .collect();
        Ok(CreationModuleCatalog {
            modules,
            handoff_version: handoff.version,
        })
    }

    pub fn add_module(
        &self,
        identity: &str,
        id: &str,
        expected_record: Option<&str>,
        expected_handoff: Option<&str>,
        protection: &Protection,
    ) -> Result<CreationModuleAddResult, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let module = MODULES
            .iter()
            .find(|module| module.id == id)
            .ok_or_else(|| {
                CreationError::new(CreationErrorCode::InvalidProject, "Unknown offline module")
            })?;
        let catalog = self.module_catalog(identity, protection)?;
        let entry = catalog
            .modules
            .iter()
            .find(|entry| entry.id == id)
            .expect("fixed catalog");
        if entry.state == ModuleState::Conflict {
            return Err(entry.error.clone().expect("conflict detail"));
        }
        if entry.record_version.as_deref() != expected_record {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, id));
        }
        if entry.state == ModuleState::Added {
            return Ok(CreationModuleAddResult {
                files: module.files(),
                handoff_recorded: true,
                already_added: true,
                error: None,
            });
        }
        if catalog.handoff_version.as_deref() != expected_handoff {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                crate::project::handoff::HANDOFF_PATH,
            ));
        }
        if entry.state == ModuleState::Available {
            publish_module(project, module, protection)?;
        }
        // Publication and task append are separate atomic writes. Report an actual
        // partial result; retry only appends the stable task and never overwrites files.
        let result = self.append_handoff(identity, &module.task(), expected_handoff, protection);
        Ok(CreationModuleAddResult {
            files: module.files(),
            handoff_recorded: result.is_ok(),
            already_added: false,
            error: result.err(),
        })
    }
}

fn source() -> ModuleSource {
    serde_json::from_str(include_str!("../../../resources/modules/SOURCE.json"))
        .expect("embedded source record")
}

fn open(directory: &File, name: &CStr, flags: i32) -> Result<Option<File>, CreationError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            0o644 as libc::c_uint,
        )
    };
    if fd >= 0 {
        return Ok(Some(unsafe { File::from_raw_fd(fd) }));
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::NotFound && flags & libc::O_CREAT == 0 {
        return Ok(None);
    }
    if matches!(error.raw_os_error(), Some(libc::ELOOP | libc::ENOTDIR)) {
        return Err(CreationError::new(
            CreationErrorCode::PathEscape,
            name.to_string_lossy(),
        ));
    }
    Err(io_error(error))
}

fn module_record(
    project: &OpenProject,
    module: &Module,
) -> Result<Option<(serde_json::Value, String)>, CreationError> {
    let Some(parent) = open(
        &project.directory,
        c"modules",
        libc::O_RDONLY | libc::O_DIRECTORY,
    )?
    else {
        return Ok(None);
    };
    let Some(directory) = open(
        &parent,
        &module.directory(),
        libc::O_RDONLY | libc::O_DIRECTORY,
    )?
    else {
        return Ok(None);
    };
    let record = open(&directory, RECORD, libc::O_RDONLY)?
        .ok_or_else(|| CreationError::new(CreationErrorCode::TargetExists, module.id))?;
    let bytes = bounded_read(record, TEXT_MAX_BYTES)?;
    let parsed: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| {
        CreationError::new(CreationErrorCode::InvalidProject, error.to_string())
    })?;
    // Preserve custom bytes; missing/escaping files require external repair.
    for (name, _) in module.files {
        let name = CString::new(*name).expect("fixed asset path");
        let file = open(&directory, &name, libc::O_RDONLY)?.ok_or_else(|| {
            CreationError::new(CreationErrorCode::Missing, name.to_string_lossy())
        })?;
        if !file.metadata().map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                name.to_string_lossy(),
            ));
        }
    }
    Ok(Some((parsed, file_version(&bytes))))
}

struct Staging {
    parent: File,
    directory: File,
    name: CString,
    published: bool,
}
impl Drop for Staging {
    fn drop(&mut self) {
        if self.published || same_directory(&self.parent, &self.name, &self.directory).is_err() {
            return;
        }
        // Flat, fixed module assets. Clean only the held unpublished staging directory.
        if let Ok(copy) = self.directory.try_clone() {
            if let Ok(names) = directory_names(copy) {
                for name in names {
                    if let Ok(name) = CString::new(name.as_bytes()) {
                        unsafe {
                            libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0);
                        }
                    }
                }
            }
        }
        unsafe {
            libc::unlinkat(
                self.parent.as_raw_fd(),
                self.name.as_ptr(),
                libc::AT_REMOVEDIR,
            );
        }
    }
}

fn publish_module(
    project: &OpenProject,
    module: &Module,
    protection: &Protection,
) -> Result<(), CreationError> {
    if unsafe { libc::mkdirat(project.directory.as_raw_fd(), c"modules".as_ptr(), 0o755) } != 0 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(io_error(error));
        }
    }
    let parent = open(
        &project.directory,
        c"modules",
        libc::O_RDONLY | libc::O_DIRECTORY,
    )?
    .ok_or_else(|| CreationError::new(CreationErrorCode::VersionConflict, "modules"))?;
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let name = CString::new(format!(".pnds-save-module-{pid}-{serial}")).expect("generated name");
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    let directory = open(&parent, &name, libc::O_RDONLY | libc::O_DIRECTORY)?.ok_or_else(|| {
        CreationError::new(CreationErrorCode::VersionConflict, name.to_string_lossy())
    })?;
    let mut staging = Staging {
        parent,
        directory,
        name,
        published: false,
    };
    let files: Vec<_> = module.files.iter().map(|(path, bytes)| serde_json::json!({ "path": path, "sha256": format!("{:x}", Sha256::digest(bytes)) })).collect();
    let record = serde_json::to_vec_pretty(&serde_json::json!({
        "formatVersion": 1, "id": module.id, "version": VERSION, "source": source(),
        "files": files, "wiring": "pending", "validation": "pending", "handoffTaskId": module.task().id,
    })).expect("module record");
    for (name, bytes) in module
        .files
        .iter()
        .copied()
        .chain(std::iter::once(("pnds-module.json", record.as_slice())))
    {
        let name = CString::new(name).expect("fixed asset name");
        let mut file = open(
            &staging.directory,
            &name,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        )?
        .expect("created file");
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
    }
    use std::os::unix::fs::PermissionsExt;
    staging
        .directory
        .set_permissions(fs::Permissions::from_mode(0o755))
        .map_err(io_error)?;
    validate_identity(project, protection)?;
    let actual = open(
        &project.directory,
        c"modules",
        libc::O_RDONLY | libc::O_DIRECTORY,
    )?
    .ok_or_else(|| CreationError::new(CreationErrorCode::VersionConflict, "modules"))?
    .metadata()
    .map_err(io_error)?;
    let held = staging.parent.metadata().map_err(io_error)?;
    if actual.dev() != held.dev() || actual.ino() != held.ino() {
        return Err(CreationError::new(
            CreationErrorCode::VersionConflict,
            "modules",
        ));
    }
    let target = module.directory();
    same_directory(&staging.parent, &staging.name, &staging.directory)?;
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            staging.parent.as_raw_fd(),
            staging.name.as_ptr(),
            staging.parent.as_raw_fd(),
            target.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            staging.parent.as_raw_fd(),
            staging.name.as_ptr(),
            staging.parent.as_raw_fd(),
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result != 0 {
        let error = io::Error::last_os_error();
        return Err(if error.kind() == io::ErrorKind::AlreadyExists {
            CreationError::new(CreationErrorCode::TargetExists, module.id)
        } else {
            io_error(error)
        });
    }
    // Published files belong to the creator; Drop must never unlink them.
    staging.published = true;
    same_directory(&staging.parent, &target, &staging.directory)?;
    Ok(())
}

fn same_directory(parent: &File, name: &CStr, held: &File) -> Result<(), CreationError> {
    let opened = open(parent, name, libc::O_RDONLY | libc::O_DIRECTORY)?.ok_or_else(|| {
        CreationError::new(CreationErrorCode::VersionConflict, name.to_string_lossy())
    })?;
    let current = opened.metadata().map_err(io_error)?;
    let original = held.metadata().map_err(io_error)?;
    if current.dev() != original.dev() || current.ino() != original.ino() {
        return Err(CreationError::new(
            CreationErrorCode::VersionConflict,
            name.to_string_lossy(),
        ));
    }
    Ok(())
}
