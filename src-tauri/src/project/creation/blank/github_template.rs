use super::*;

const TEMPLATE_ID: &str = "pnds-blank-template";
const FILES: &[(&str, &[u8])] = &[
    (
        "scripts/init-pnds.mjs",
        include_bytes!("../../../../resources/blank-project/scripts/init-pnds.mjs"),
    ),
    (
        "docs/github-template.en.md",
        include_bytes!("../../../../resources/blank-project/docs/github-template.en.md"),
    ),
    (
        "docs/github-template.zh-CN.md",
        include_bytes!("../../../../resources/blank-project/docs/github-template.zh-CN.md"),
    ),
];

/// Export the Blank snapshot to a new directory for the maintainer to commit.
pub fn export(target: &Path) -> Result<String, CreationError> {
    let folder = target.file_name().ok_or_else(|| {
        CreationError::new(CreationErrorCode::InvalidProject, "Choose a new directory")
    })?;
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent).map_err(io_error)?;
    let target = parent.join(folder);
    let open_directory = |path: &Path| {
        File::options()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(path)
            .map_err(io_error)
    };
    let held = open_directory(&parent)?;
    let staging = tempfile::Builder::new()
        .prefix(".pnds-template-")
        .tempdir_in(&parent)
        .map_err(io_error)?;
    check_directory_identity(&parent, &held)?;
    let root = open_directory(staging.path())?;
    let options = NewProjectOptions {
        parent: String::new(),
        folder_name: String::new(),
        name: "PNDS Blank".into(),
        author: String::new(),
        description: String::new(),
        locale: "en".into(),
        git_name: None,
        git_email: None,
    };
    write_project(&root, &options, TEMPLATE_ID, true)?;
    for (path, bytes) in FILES {
        write(&root, path, bytes)?;
    }
    check_directory_identity(&parent, &held)?;
    check_directory_identity(staging.path(), &root)?;
    publish_staged_directory(&held, staging, &target)?;
    Ok(format!("pnds-blank-v{TEMPLATE_VERSION}"))
}
