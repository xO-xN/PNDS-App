use super::*;
use crate::project::handoff::AGENT_ENTRY;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Deserialize;

#[cfg(any(test, feature = "blank-template-export"))]
pub(super) mod github_template;

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectOptions {
    pub parent: String,
    pub folder_name: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub locale: String,
    #[serde(default)]
    pub git_name: Option<String>,
    #[serde(default)]
    pub git_email: Option<String>,
}

const TEMPLATE_VERSION: &str = "1.7.0";
const ASSETS: &[(&str, &[u8])] = &[
    (
        "recording/adapter.cjs",
        include_bytes!("../../../resources/performance-recording/adapter.cjs"),
    ),
    (
        "performance/recording.js",
        include_bytes!("../../../resources/blank-project/performance/recording.js"),
    ),
    (
        "pnds.recording.json",
        b"{\"protocolVersion\":1,\"adapterId\":\"pnds-blank-input-v1\"}\n",
    ),
    (
        ".gitignore",
        include_bytes!("../../../resources/blank-project/project.gitignore"),
    ),
    (
        "server.js",
        include_bytes!("../../../resources/blank-project/server.js"),
    ),
    (
        "performance/state.js",
        include_bytes!("../../../resources/blank-project/performance/state.js"),
    ),
    (
        "players/policy.js",
        include_bytes!("../../../resources/blank-project/players/policy.js"),
    ),
    (
        "audio/controller.js",
        include_bytes!("../../../resources/blank-project/audio/controller.js"),
    ),
    (
        "lib/monitor-view.js",
        include_bytes!("../../../resources/blank-project/lib/monitor-view.js"),
    ),
    (
        "public/monitor-view.json",
        include_bytes!("../../../resources/blank-project/public/monitor-view.json"),
    ),
    (
        "public/monitor.js",
        include_bytes!("../../../resources/blank-project/public/monitor.js"),
    ),
    (
        "public/pnds-input.js",
        include_bytes!("../../../resources/blank-project/public/pnds-input.js"),
    ),
    (
        "public/performer.js",
        include_bytes!("../../../resources/blank-project/public/performer.js"),
    ),
    (
        "public/style.css",
        include_bytes!("../../../resources/blank-project/public/style.css"),
    ),
    (
        "public/pnds-preview.mjs",
        include_bytes!("../../../resources/parameter-preview/adapter.mjs"),
    ),
    (
        "pnds.preview.json",
        include_bytes!("../../../resources/blank-project/pnds.preview.json"),
    ),
    (
        "supercollider/source/pndsBlank.scd",
        include_bytes!("../../../resources/blank-project/supercollider/source/pndsBlank.scd"),
    ),
    (
        "supercollider/synthdefs/pndsBlank.scsyndef",
        include_bytes!(
            "../../../resources/blank-project/supercollider/synthdefs/pndsBlank.scsyndef"
        ),
    ),
];

pub(super) fn is_blank_source(path: &str, bytes: &[u8], name: &str) -> bool {
    if modules::is_default_source(path, bytes) {
        return true;
    }
    if ASSETS
        .iter()
        .any(|(asset, expected)| *asset == path && *expected == bytes)
    {
        return true;
    }
    if !matches!(path, "public/monitor.html" | "public/performer.html") {
        return false;
    }
    [
        ("en", include_str!("../../../../locales/en.json")),
        ("zh-CN", include_str!("../../../../locales/zh-CN.json")),
    ]
    .iter()
    .any(|(locale, json)| {
        let strings: serde_json::Value = serde_json::from_str(json).expect("embedded locales");
        let message = strings["creation.newProject.pageMessage"]
            .as_str()
            .expect("page message");
        include_str!("../../../resources/blank-project/public/page.html")
            .replace("{{lang}}", locale)
            .replace("{{message}}", message)
            .replace(
                "{{role}}",
                if path == "public/monitor.html" {
                    "monitor"
                } else {
                    "performer"
                },
            )
            .replace(
                "{{roleScripts}}",
                if path == "public/performer.html" {
                    "<script src=\"./pnds-players.js\"></script>\n<script src=\"./pnds-input.js\"></script>"
                } else if path == "public/monitor.html" {
                    "<script src=\"./monitor-state-client.js\"></script>"
                } else {
                    ""
                },
            )
            .replace("{{name}}", &html(name))
            .as_bytes()
            == bytes
    })
}

impl CreationAccess {
    /// Generate a complete sibling staging tree, publish with no-clobber rename,
    /// then prepare the workspace. Existing active identities remain valid.
    pub fn create_blank(
        &mut self,
        options: &NewProjectOptions,
        resources: &Path,
        protection: &Protection,
    ) -> Result<CreationWorkspace, CreationError> {
        self.create_generated(options, protection, Some(resources), |root, options| {
            let id = project_id(&options.folder_name)?;
            write_project(root, options, &id, false)
        })
    }

    pub(super) fn create_generated(
        &mut self,
        options: &NewProjectOptions,
        protection: &Protection,
        libraries: Option<&Path>,
        generate: impl FnOnce(&File, &NewProjectOptions) -> Result<(), CreationError>,
    ) -> Result<CreationWorkspace, CreationError> {
        validate(options)?;
        let parent = fs::canonicalize(&options.parent).map_err(io_error)?;
        local_git::require_no_parent_repository(&parent)?;
        let held = File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&parent)
            .map_err(io_error)?;
        let target = parent.join(&options.folder_name);
        if matches!(
            protection.source(&target),
            CreationSource::Bundle | CreationSource::Utility
        ) {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "Choose a source-project location outside installed bundles and utilities",
            ));
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                return Err(CreationError::new(
                    CreationErrorCode::TargetExists,
                    target.to_string_lossy(),
                ))
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        let staging = tempfile::Builder::new()
            .prefix(".pnds-create-")
            .tempdir_in(&parent)
            .map_err(io_error)?;
        check_directory_identity(&parent, &held)?;
        let staged = File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(staging.path())
            .map_err(io_error)?;
        generate(&staged, options)?;
        check_directory_identity(staging.path(), &staged)?;
        // A newly created project owns an empty transcript, even when its path
        // has an older App-local migration backup. Publish it with the tree.
        initialize_empty_chat(&staged, &target)?;
        crate::project::bundle::validate_packable_with_libraries(staging.path(), libraries)
            .map_err(|detail| CreationError::new(CreationErrorCode::InvalidProject, detail))?;
        local_git::initialize_generated(staging.path(), options)?;
        check_directory_identity(&parent, &held)?;
        check_directory_identity(staging.path(), &staged)?;
        publish_staged_directory(&held, staging, &target)?;
        self.prepare(&target, protection).map_err(|error| {
            CreationError::new(
                error.code,
                format!(
                    "Project created at {}, but opening failed: {}",
                    target.display(),
                    error.detail
                ),
            )
        })
    }
}

pub(super) fn initialize_empty_chat(staged: &File, target: &Path) -> Result<(), CreationError> {
    let records = crate::creation_data::open(staged).map_err(io_error)?;
    crate::assistant_history::AssistantHistoryStore::default()
        .clear_at(&records, &crate::assistant_history::key_for_root(target))
        .map_err(|error| {
            CreationError::new(
                CreationErrorCode::Io,
                format!("Could not initialize new project chat history: {error:?}"),
            )
        })?;
    Ok(())
}

pub(super) fn publish_staged_directory(
    held: &File,
    staging: tempfile::TempDir,
    target: &Path,
) -> Result<(), CreationError> {
    let staged_name = CString::new(staging.path().file_name().expect("tempdir name").as_bytes())
        .expect("generated temp name");
    let name = CString::new(target.file_name().expect("validated name").as_bytes())
        .expect("validated name");
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            held.as_raw_fd(),
            staged_name.as_ptr(),
            held.as_raw_fd(),
            name.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            held.as_raw_fd(),
            staged_name.as_ptr(),
            held.as_raw_fd(),
            name.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result != 0 {
        let error = io::Error::last_os_error();
        return Err(if error.kind() == io::ErrorKind::AlreadyExists {
            CreationError::new(CreationErrorCode::TargetExists, target.to_string_lossy())
        } else {
            io_error(error)
        });
    }
    let _ = staging.keep(); // The published directory now belongs to the creator.
    Ok(())
}

fn validate(options: &NewProjectOptions) -> Result<(), CreationError> {
    let id = &options.folder_name;
    let single_line =
        |text: &str| text.chars().count() <= 128 && !text.contains(['\r', '\n', '\0']);
    if id.is_empty()
        || id.chars().count() > 64
        || !id
            .chars()
            .all(|char| (char.is_alphanumeric() && !char.is_uppercase()) || char == '-')
        || id.starts_with('-')
        || id.ends_with('-')
        || options.name.trim().is_empty()
        || !single_line(&options.name)
        || !single_line(&options.author)
        || options.description.chars().count() > 4096
        || !["en", "zh-CN"].contains(&options.locale.as_str())
    {
        return Err(CreationError::new(CreationErrorCode::InvalidProject, "Enter a name, a single kebab-case folder name, an optional author/description, and a supported language"));
    }
    Ok(())
}

pub(super) fn check_directory_identity(path: &Path, held: &File) -> Result<(), CreationError> {
    if fs::symlink_metadata(path)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(CreationError::new(
            CreationErrorCode::PathEscape,
            "A selected directory was replaced by a symlink",
        ));
    }
    let current = fs::metadata(path).map_err(io_error)?;
    let original = held.metadata().map_err(io_error)?;
    if current.dev() != original.dev() || current.ino() != original.ino() {
        return Err(CreationError::new(
            CreationErrorCode::InvalidIdentity,
            "The selected parent directory changed; choose it again",
        ));
    }
    Ok(())
}

pub(super) fn write(root: &File, path: &str, bytes: &[u8]) -> Result<(), CreationError> {
    let parts: Vec<_> = path.split('/').collect();
    let mut directory = root.try_clone().map_err(io_error)?;
    for part in &parts[..parts.len() - 1] {
        let name = CString::new(*part).expect("fixed asset path");
        if unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(io_error(error));
            }
        }
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    let name =
        CString::new(*parts.last().expect("fixed asset filename")).expect("fixed asset path");
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o644 as libc::c_uint,
        )
    };
    if fd < 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

pub(super) fn html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn project_id(folder: &str) -> Result<String, CreationError> {
    let mut random = [0u8; 16];
    SystemRandom::new().fill(&mut random).map_err(|_| {
        CreationError::new(
            CreationErrorCode::Io,
            "Could not generate an independent project identity",
        )
    })?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let stem: String = folder
        .chars()
        .filter(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || *char == '-')
        .collect();
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() { "score" } else { stem };
    Ok(format!("{stem}-{suffix}"))
}

fn write_project(
    root: &File,
    options: &NewProjectOptions,
    id: &str,
    is_github_template: bool,
) -> Result<(), CreationError> {
    let name = options.name.trim();
    let author = options.author.trim();
    let manifest = serde_json::json!({ "schemaVersion": 2, "id": id, "name": name, "version": "0.1.0", "description": options.description, "sharedLibraries": [{ "id": "express", "version": "5.3.0" }, { "id": "socket.io", "version": "4.8.4" }, { "id": "osc-min", "version": "2.1.2" }], "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869, "runtimePorts": 1, "supportsPerformerUrl": true, "browserParticipation": 1 }, "audio": { "defaultMode": "internal", "supportedModes": ["internal", "external", "none"], "outputChannels": 2, "synthdefs": ["supercollider/synthdefs/pndsBlank.scsyndef"], "scsynth": { "blockSize": 64, "audioBusChannels": 128 } } });
    write(
        root,
        "manifest.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).expect("literal object")
        )
        .as_bytes(),
    )?;
    let mut package = serde_json::json!({ "name": id, "version": "0.1.0", "private": true, "type": "module", "author": author, "description": options.description, "engines": { "node": ">=24 <25" }, "scripts": { "start": "node server.js" }, "dependencies": { "express": "5.3.0", "socket.io": "4.8.4", "osc-min": "2.1.2" } });
    if is_github_template {
        package["scripts"]["init:pnds"] = serde_json::json!("node scripts/init-pnds.mjs");
    }
    write(
        root,
        "package.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&package).expect("literal object")
        )
        .as_bytes(),
    )?;
    modules::write_default_module(root, "players")?;
    for (path, bytes) in ASSETS {
        write(root, path, bytes)?
    }
    super::modules::write_default_module(root, "monitor-state")?;
    let chinese = options.locale == "zh-CN";
    let strings: serde_json::Value = serde_json::from_str(if chinese {
        include_str!("../../../../locales/zh-CN.json")
    } else {
        include_str!("../../../../locales/en.json")
    })
    .expect("bundled locale JSON");
    let translated = |key: &str| {
        strings[key]
            .as_str()
            .expect("generated-project translation key")
    };
    let heading = translated("creation.newProject.readmeHeading");
    let page_message = translated("creation.newProject.pageMessage");
    let description = options.description.trim();
    let mut markdown =
        format!("# {name}\n\ntitle: {name}\ncomposer: {author}\n\n## {heading}\n\n{description}\n");
    if is_github_template {
        markdown.push_str(
            "\n---\n\n[Initialize this template](docs/github-template.en.md) · [初始化模板](docs/github-template.zh-CN.md)\n\n[Public PNDS projects · 公开工程目录](https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories)\n",
        );
    }
    write(root, "README.md", markdown.as_bytes())?;
    let agent_hint = translated("creation.newProject.agentHint");
    let conventions = include_str!("../../../resources/creator-project-conventions.md");
    write(
        root,
        "AGENTS.md",
        format!("# {name}\n\n{agent_hint}\n\n{conventions}\n{AGENT_ENTRY}").as_bytes(),
    )?;
    let guide = if chinese {
        include_str!("../../../resources/blank-project/docs/implementation.zh-CN.md")
    } else {
        include_str!("../../../resources/blank-project/docs/implementation.en.md")
    };
    write(
        root,
        "docs/implementation.md",
        guide
            .replace("{{templateVersion}}", TEMPLATE_VERSION)
            .as_bytes(),
    )?;
    write(
        root,
        "public/pnds-player.json",
        serde_json::to_string_pretty(&serde_json::json!({
            "projectId": id,
        "recordingPerformer": translated("creation.newProject.recordingPerformer"),
            "messages": {
                "waiting": translated("creation.newProject.playerWaiting"),
                "ready": translated("creation.newProject.playerReady"),
                "error": translated("creation.newProject.playerError"),
            },
        }))
        .expect("player configuration")
        .as_bytes(),
    )?;
    for role in ["monitor", "performer"] {
        let page = include_str!("../../../resources/blank-project/public/page.html")
            .replace("{{lang}}", &options.locale)
            .replace("{{message}}", page_message)
            .replace("{{role}}", role)
            .replace(
                "{{roleScripts}}",
                if role == "performer" {
                    "<script src=\"./pnds-players.js\"></script>\n<script src=\"./pnds-input.js\"></script>"
                } else if role == "monitor" {
                    "<script src=\"./monitor-state-client.js\"></script>"
                } else {
                    ""
                },
            )
            .replace("{{name}}", &html(name));
        write(root, &format!("public/{role}.html"), page.as_bytes())?;
    }
    let origin = if is_github_template {
        "PNDS GitHub Blank template"
    } else {
        "PNDS App embedded blank-project"
    };
    let source = serde_json::json!({"template":"Blank","version":TEMPLATE_VERSION,"source":origin});
    write(
        root,
        "docs/template-source.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&source).expect("literal source")
        )
        .as_bytes(),
    )
}
