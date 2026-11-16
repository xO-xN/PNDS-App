//! Static selected-plan files, separate from handoff records and execution journals.
use super::text_publication::{
    publish_text_at, CreatePermissions, PublicationState, PublishPolicy, TextPublication,
};
use super::*;
use ring::rand::{SecureRandom, SystemRandom};
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTerminalTaskContext {
    pub project_root: String,
    pub documentation_root: String,
    pub checker_path: String,
}

impl CreationAccess {
    pub fn terminal_task_context(
        &self,
        identity: &str,
        documentation_root: &Path,
        checker_path: &Path,
        protection: &Protection,
    ) -> Result<ProjectTerminalTaskContext, CreationError> {
        self.terminal_directory(identity, protection)?;
        for relative in ["reference/README.md", "app-tutorial.md"] {
            let path = documentation_root.join(relative);
            if !path.is_absolute()
                || !File::open(&path)
                    .and_then(|file| file.metadata())
                    .is_ok_and(|metadata| metadata.is_file())
            {
                let display = path.display();
                return Err(CreationError::new(
                    CreationErrorCode::Io,
                    format!("Local PNDS documentation is unavailable: {display}"),
                ));
            }
        }
        let executable =
            CString::new(checker_path.as_os_str().as_encoded_bytes()).is_ok_and(|path| {
                // SAFETY: access only reads OS permissions through this live C string.
                unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
            });
        if !checker_path.is_absolute()
            || !checker_path
                .metadata()
                .is_ok_and(|metadata| metadata.is_file())
            || !executable
        {
            let display = checker_path.display();
            return Err(CreationError::new(
                CreationErrorCode::Io,
                format!("The installed PNDS checker is unavailable: {display}"),
            ));
        }
        self.terminal_directory(identity, protection)?;
        let path_text = |path: &Path| {
            path.to_str().map(str::to_owned).ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::InvalidProject,
                    "The task path is not UTF-8",
                )
            })
        };
        Ok(ProjectTerminalTaskContext {
            project_root: path_text(&self.current(identity, protection)?.root)?,
            documentation_root: path_text(documentation_root)?,
            checker_path: path_text(checker_path)?,
        })
    }

    pub fn write_terminal_task(
        &self,
        identity: &str,
        contents: &str,
        protection: &Protection,
    ) -> Result<PathBuf, CreationError> {
        if contents.trim().is_empty()
            || contents.len() > TEXT_MAX_BYTES as usize
            || contents.contains('\0')
        {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Terminal task must contain bounded UTF-8 text",
            ));
        }
        let root = self.terminal_directory(identity, protection)?;
        let directory = crate::creation_data::open(&root).map_err(io_error)?;
        let held = directory.metadata().map_err(io_error)?;
        let mut random = [0_u8; 16];
        SystemRandom::new().fill(&mut random).map_err(|_| {
            CreationError::new(CreationErrorCode::Io, "Could not name the terminal task")
        })?;
        let id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let name = CString::new(format!("terminal-task-{id}.md")).expect("generated task filename");
        let published = publish_text_at(
            TextPublication {
                directory: &directory,
                name: &name,
                bytes: contents.as_bytes(),
                policy: PublishPolicy::Create {
                    permissions: CreatePermissions::Exact(fs::Permissions::from_mode(0o600)),
                },
            },
            || {
                let current_root = self.terminal_directory(identity, protection)?;
                let current = crate::creation_data::open(&current_root)
                    .and_then(|directory| directory.metadata())
                    .map_err(io_error)?;
                if current.dev() != held.dev() || current.ino() != held.ino() {
                    return Err(CreationError::new(
                        CreationErrorCode::InvalidIdentity,
                        "The private task directory changed",
                    ));
                }
                Ok(())
            },
        )?;
        if published.state != PublicationState::Installed {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "The terminal task destination is occupied",
            ));
        }
        directory.sync_all().map_err(io_error)?;
        Ok(self
            .current(identity, protection)?
            .root
            .join(crate::creation_data::DIRECTORY)
            .join(name.to_str().expect("generated UTF-8 filename")))
    }
}
