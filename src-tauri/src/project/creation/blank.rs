use super::*;
use crate::project::handoff::{append_task, initial_document, HandoffTask, AGENT_ENTRY};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectOptions {
    pub parent: String,
    pub folder_name: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub locale: String,
}

const ASSETS: &[(&str, &[u8])] = &[
    (
        "server.js",
        include_bytes!("../../../resources/blank-project/server.js"),
    ),
    (
        "audio/controller.js",
        include_bytes!("../../../resources/blank-project/audio/controller.js"),
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

impl CreationAccess {
    /// Generate a complete sibling staging tree, publish with no-clobber rename,
    /// then prepare the workspace. Existing active identities remain valid.
    pub fn create_blank(
        &mut self,
        options: &NewProjectOptions,
        protection: &Protection,
    ) -> Result<CreationWorkspace, CreationError> {
        self.create_generated(options, protection, None, write_project)
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
        crate::project::bundle::validate_packable_with_libraries(staging.path(), libraries)
            .map_err(|detail| CreationError::new(CreationErrorCode::InvalidProject, detail))?;
        check_directory_identity(&parent, &held)?;
        check_directory_identity(staging.path(), &staged)?;
        let staged_name =
            CString::new(staging.path().file_name().expect("tempdir name").as_bytes())
                .expect("generated temp name");
        let name = CString::new(options.folder_name.as_bytes()).expect("validated name");
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

fn validate(options: &NewProjectOptions) -> Result<(), CreationError> {
    let id = &options.folder_name;
    let single_line =
        |text: &str| text.chars().count() <= 128 && !text.contains(['\r', '\n', '\0']);
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
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

fn check_directory_identity(path: &Path, held: &File) -> Result<(), CreationError> {
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
    Ok(format!("{folder}-{suffix}"))
}

fn write_project(root: &File, options: &NewProjectOptions) -> Result<(), CreationError> {
    let id = project_id(&options.folder_name)?;
    let name = options.name.trim();
    let author = options.author.trim();
    let manifest = serde_json::json!({ "schemaVersion": 1, "id": id, "name": name, "version": "0.1.0", "description": options.description, "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }, "audio": { "defaultMode": "internal", "supportedModes": ["internal", "external", "none"], "outputChannels": 2, "synthdefs": ["supercollider/synthdefs/pndsBlank.scsyndef"], "scsynth": { "blockSize": 64, "audioBusChannels": 128 } } });
    write(
        root,
        "manifest.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).expect("literal object")
        )
        .as_bytes(),
    )?;
    let package = serde_json::json!({ "name": id, "version": "0.1.0", "private": true, "type": "module", "author": author, "description": options.description, "engines": { "node": ">=24 <25" }, "scripts": { "start": "node server.js" } });
    write(
        root,
        "package.json",
        format!(
            "{}\n",
            serde_json::to_string_pretty(&package).expect("literal object")
        )
        .as_bytes(),
    )?;
    for (path, bytes) in ASSETS {
        write(root, path, bytes)?
    }
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
    let (readme, target) = if chinese {
        ("README.zh-CN.md", "README.md")
    } else {
        ("README.md", "README.zh-CN.md")
    };
    let heading = translated("creation.newProject.readmeHeading");
    let body = translated("creation.newProject.readmeBody");
    let page_message = translated("creation.newProject.pageMessage");
    let description = if options.description.trim().is_empty() {
        body
    } else {
        options.description.trim()
    };
    let markdown =
        format!("# {name}\n\ntitle: {name}\ncomposer: {author}\n\n## {heading}\n\n{description}\n");
    write(root, readme, markdown.as_bytes())?;
    let version = file_version(markdown.as_bytes());
    let task_text = |key| {
        translated(key)
            .replace("{{source}}", readme)
            .replace("{{target}}", target)
            .replace("{{version}}", &version)
    };
    let task = HandoffTask {
        id: "00000000-0000-4000-8000-000000000160".into(),
        intent: task_text("creation.handoff.syncIntent"),
        files: vec![readme.into(), target.into()],
        acceptance: task_text("creation.handoff.syncAcceptance"),
        status: "pending".into(),
    };
    write(
        root,
        "docs/creator-handoff.md",
        append_task(&initial_document(), &task).as_bytes(),
    )?;
    let agent_hint = translated("creation.newProject.agentHint");
    write(
        root,
        "AGENTS.md",
        format!("# {name}\n\n{AGENT_ENTRY}\n\n{agent_hint}\n").as_bytes(),
    )?;
    let page = include_str!("../../../resources/blank-project/public/page.html")
        .replace("{{lang}}", &options.locale)
        .replace("{{message}}", page_message)
        .replace("{{name}}", &html(name));
    write(root, "public/monitor.html", page.as_bytes())?;
    write(root, "public/performer.html", page.as_bytes())?;
    write(root, "docs/template-source.json", b"{\n  \"template\": \"Blank\",\n  \"version\": \"1.6.0\",\n  \"source\": \"PNDS App embedded blank-project\"\n}\n")
}
