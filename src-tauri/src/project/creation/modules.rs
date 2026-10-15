//! Frozen offline files, exclusive directory publication, then an idempotent handoff.
use super::*;
use crate::project::handoff::HandoffTask;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const VERSION: &str = "0.2.0";
const LEGACY_REVISION: &str = "e3f4769537d6aeb2016b76610e80dea7b639384f";
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
            asset!("qr", "compatibility.json"),
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
            asset!("players", "compatibility.json"),
            LICENSE,
        ],
    },
    Module {
        id: "theme-follow",
        files: &[
            asset!("theme-follow", "theme-follow.js"),
            asset!("theme-follow", "package.json"),
            asset!("theme-follow", "README.md"),
            asset!("theme-follow", "compatibility.json"),
            LICENSE,
        ],
    },
    Module {
        id: "locale-follow",
        files: &[
            asset!("locale-follow", "locale-follow.js"),
            asset!("locale-follow", "package.json"),
            asset!("locale-follow", "README.md"),
            asset!("locale-follow", "compatibility.json"),
            LICENSE,
        ],
    },
    Module {
        id: "monitor-state",
        files: &[
            asset!("monitor-state", "monitor-state.js"),
            asset!("monitor-state", "monitor-client.js"),
            asset!("monitor-state", "package.json"),
            asset!("monitor-state", "README.md"),
            asset!("monitor-state", "compatibility.json"),
            LICENSE,
        ],
    },
    Module {
        id: "hub",
        files: &[
            asset!("hub", "hub.js"),
            asset!("hub", "package.json"),
            asset!("hub", "README.md"),
            asset!("hub", "compatibility.json"),
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

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModuleCompatibility {
    version: String,
    host_protocol: u32,
    runtime: Vec<String>,
    adaptation: Vec<String>,
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
    pub shipped_version: String,
    pub compatibility: Option<ModuleCompatibility>,
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
    fn compatibility(&self) -> ModuleCompatibility {
        let bytes = self
            .files
            .iter()
            .find(|(name, _)| *name == "compatibility.json")
            .expect("complete frozen module")
            .1;
        serde_json::from_slice(bytes).expect("frozen module compatibility")
    }
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
    fn task(&self, version: &str, files: Vec<String>) -> HandoffTask {
        let digest = format!(
            "{:x}",
            Sha256::digest(format!("pnds-module:{}:{version}", self.id))
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
            intent: format!("Wire PNDS module {} / 接入 PNDS 模块 {} ({version}). Read its README before choosing dependencies, routes, events and project-specific behavior. / 先阅读模块 README，再确认依赖、路由、事件与作品行为。", self.id, self.id),
            files,
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
                    shipped_version: VERSION.into(),
                    compatibility: Some(module.compatibility()),
                    files: module.files(),
                    state: ModuleState::Available,
                    record_version: None,
                    error: None,
                };
                match module_record(project, module) {
                    Ok(Some((record, version))) => {
                        entry.record_version = Some(version);
                        entry.version =
                            record["version"].as_str().expect("validated record").into();
                        entry.source = serde_json::from_value(record["source"].clone())
                            .expect("validated source");
                        entry.compatibility = record
                            .get("compatibility")
                            .and_then(|value| serde_json::from_value(value.clone()).ok());
                        entry.files = recorded_files(module, &record);
                        let task = module.task(&entry.version, entry.files.clone());
                        entry.state = if handoff.text.lines().any(|line| line == task.marker()) {
                            ModuleState::Added
                        } else {
                            ModuleState::NeedsHandoff
                        };
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
                files: entry.files.clone(),
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
        let result = self.append_handoff(
            identity,
            &module.task(&entry.version, entry.files.clone()),
            expected_handoff,
            protection,
        );
        Ok(CreationModuleAddResult {
            files: entry.files.clone(),
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
    let legacy = parsed["version"] == "0.1.0"
        && parsed["source"]["repository"] == "https://github.com/xO-xN/PNDS-Template"
        && parsed["source"]["revision"] == LEGACY_REVISION
        && parsed["source"]["version"] == "0.5.1"
        && module.id != "hub";
    let shipped: serde_json::Value =
        serde_json::from_str(include_str!("../../../resources/modules/SOURCE.json"))
            .expect("frozen current provenance");
    let previous: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../resources/modules/PREVIOUS.json"))
            .expect("frozen previous provenance");
    let release = std::iter::once(&shipped)
        .chain(previous.iter())
        .find(|release| {
            parsed["version"] == release["moduleVersion"]
                && parsed["source"]["repository"] == release["repository"]
                && parsed["source"]["revision"] == release["revision"]
                && parsed["source"]["version"] == release["version"]
        });
    let Some(files) = parsed["files"].as_array() else {
        return Err(CreationError::new(
            CreationErrorCode::InvalidProject,
            module.id,
        ));
    };
    let required: Vec<String> = if legacy {
        match module.id {
            "qr" => vec!["qr.js", "package.json", "README.md", "LICENSE.md"],
            "players" => vec![
                "players.js",
                "seats-store.js",
                "protocol.js",
                "client.js",
                "package.json",
                "README.md",
                "LICENSE.md",
            ],
            "theme-follow" => vec!["theme-follow.js", "package.json", "README.md", "LICENSE.md"],
            "locale-follow" => vec![
                "locale-follow.js",
                "package.json",
                "README.md",
                "LICENSE.md",
            ],
            "monitor-state" => vec![
                "monitor-state.js",
                "client.js",
                "package.json",
                "README.md",
                "LICENSE.md",
            ],
            _ => unreachable!("legacy catalog"),
        }
        .into_iter()
        .map(String::from)
        .collect()
    } else {
        release
            .map(|release| {
                let prefix = format!("{}/", module.id);
                release["files"]
                    .as_object()
                    .expect("frozen file list")
                    .keys()
                    .filter_map(|name| name.strip_prefix(&prefix).map(String::from))
                    .chain(std::iter::once("LICENSE.md".to_string()))
                    .collect()
            })
            .unwrap_or_default()
    };
    if parsed["formatVersion"] != 1
        || parsed["id"] != module.id
        || !(legacy || release.is_some())
        || files.len() != required.len()
        || required
            .iter()
            .any(|name| files.iter().filter(|file| file["path"] == *name).count() != 1)
        || files.iter().any(|file| {
            file["sha256"].as_str().is_none_or(|hash| {
                hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        })
    {
        return Err(CreationError::new(
            CreationErrorCode::TargetExists,
            module.id,
        ));
    }
    let legacy_hashes: serde_json::Value =
        serde_json::from_str(include_str!("../../../resources/modules/LEGACY.json"))
            .expect("frozen legacy provenance");
    if files.iter().any(|file| {
        let name = file["path"].as_str().expect("validated file name");
        let expected = if legacy {
            let path = if name == "LICENSE.md" {
                name.to_string()
            } else {
                format!("{}/{name}", module.id)
            };
            legacy_hashes[&path]
                .as_str()
                .unwrap_or_default()
                .to_string()
        } else {
            let path = if name == "LICENSE.md" {
                name.to_string()
            } else {
                format!("{}/{name}", module.id)
            };
            release.expect("validated release")["files"][path]
                .as_str()
                .unwrap_or_default()
                .to_string()
        };
        file["sha256"] != expected
    }) {
        return Err(CreationError::new(
            CreationErrorCode::TargetExists,
            module.id,
        ));
    }
    // Validate the recorded release's file set, never the new App's file set.
    // Author edits remain valid; hashes establish original provenance, not current wiring.
    for name in required {
        let name = CString::new(name).expect("fixed asset path");
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

fn recorded_files(module: &Module, record: &serde_json::Value) -> Vec<String> {
    let id = module.id;
    record["files"]
        .as_array()
        .expect("validated record")
        .iter()
        .map(|file| {
            let path = file["path"].as_str().expect("validated path");
            format!("modules/pnds-{id}/{path}")
        })
        .chain(std::iter::once(format!(
            "modules/pnds-{id}/pnds-module.json"
        )))
        .collect()
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
        "files": files, "compatibility": module.compatibility(), "wiring": "pending", "validation": "pending", "handoffTaskId": module.task(VERSION, module.files()).id,
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
