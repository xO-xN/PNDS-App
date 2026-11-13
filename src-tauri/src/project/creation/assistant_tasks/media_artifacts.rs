//! New media artifacts keep byte backups in the held project-private directory.
use super::super::text_publication::publish_stream_at;
use super::{super::materials as documents, *};
use std::io::Seek;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct MediaDigest {
    pub hash: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
pub(super) struct MediaArtifact {
    pub path: String,
    before: Option<MediaDigest>,
    after: MediaDigest,
    backup: Option<String>,
    permissions: u32,
    version: Option<String>,
    publishing: bool,
    undoing: bool,
    pub undone: bool,
}
impl MediaArtifact {
    pub(super) fn has_published(&self, path: &str) -> bool {
        self.path == path && !self.undone && !self.publishing && !self.undoing
    }

    fn version(&self) -> &str {
        self.version.as_deref().unwrap_or(&self.after.hash)
    }

    pub(super) fn created(&self) -> bool {
        self.before.is_none()
    }
}

impl Journal {
    pub(super) fn validate_media_artifacts(&self) -> Result<(), CreationError> {
        let mut paths = std::collections::HashSet::new();
        let mut backups = std::collections::HashSet::new();
        for entry in &self.media_artifacts {
            directories::admitted(&entry.path)?;
            let valid_digest = |digest: &MediaDigest| {
                let limit = if image_mime(&entry.path).is_some() {
                    documents::IMAGE_LIMIT
                } else {
                    documents::AUDIO_LIMIT
                };
                digest.size <= limit
                    && digest.hash.len() == 64
                    && digest.hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            };
            if !admitted_media(&entry.path)
                || !paths.insert(entry.path.to_ascii_lowercase())
                || !valid_digest(&entry.after)
                || entry
                    .before
                    .as_ref()
                    .is_some_and(|digest| !valid_digest(digest))
                || entry.before.is_some() != entry.backup.is_some()
                || entry
                    .backup
                    .as_ref()
                    .is_some_and(|name| !valid_assistant_task_id(name) || !backups.insert(name))
                || (entry.publishing && (entry.undoing || entry.undone))
                || (entry.undoing && entry.undone)
            {
                return Err(invalid("Invalid media artifact recovery"));
            }
        }
        Ok(())
    }
}

pub(super) fn reclaim_media_backups(
    project: &OpenProject,
    journal: &Journal,
    retained: impl Fn(&str) -> bool,
) -> Result<(), CreationError> {
    for backup in journal
        .media_artifacts
        .iter()
        .filter_map(|entry| entry.backup.as_deref())
    {
        if !retained(backup) {
            documents::unlink(&backup_directory(project)?, backup)
                .map_err(|cause| invalid(format!("Private media cleanup: {cause:?}")))?;
        }
    }
    Ok(())
}

impl MediaArtifact {
    pub(super) fn references_backup(&self, backup: &str) -> bool {
        self.backup.as_deref() == Some(backup)
    }
}

fn conflict(path: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, path)
}

fn admitted_media(path: &str) -> bool {
    documents::audio_format(path).is_some() || image_mime(path).is_some()
}

fn media_target(project: &OpenProject, path: &str) -> Result<(File, CString), CreationError> {
    if !admitted_media(path) {
        return Err(invalid("Use a supported media destination"));
    }
    directories::admitted(path)?;
    directories::parent(project, path)
}

fn digest_media(file: &mut File) -> io::Result<MediaDigest> {
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > documents::AUDIO_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid media artifact size",
        ));
    }
    file.rewind()?;
    let mut digest = Sha256::new();
    let size = io::copy(&mut file.take(documents::AUDIO_LIMIT + 1), &mut digest)?;
    if size > documents::AUDIO_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Media artifact exceeds its limit",
        ));
    }
    file.rewind()?;
    Ok(MediaDigest {
        hash: format!("{:x}", digest.finalize()),
        size,
    })
}

fn open_media_at(
    directory: &File,
    name: &CStr,
) -> Result<Option<(File, MediaDigest)>, CreationError> {
    match super::super::compile::open_at(directory, name, libc::O_RDONLY, 0) {
        Ok(mut file) => {
            let digest = digest_media(&mut file).map_err(io_error)?;
            Ok(Some((file, digest)))
        }
        Err(cause) if cause.code == CreationErrorCode::Missing => Ok(None),
        Err(cause) => Err(cause),
    }
}

pub(super) fn media_digest(
    project: &OpenProject,
    path: &str,
) -> Result<Option<MediaDigest>, CreationError> {
    let (directory, name) = media_target(project, path)?;
    Ok(open_media_at(&directory, &name)?.map(|(_, digest)| digest))
}

fn backup_directory(project: &OpenProject) -> Result<File, CreationError> {
    let directory = crate::creation_data::open(&project.directory).map_err(io_error)?;
    documents::directory_at(&directory, "assistant-media")
        .map_err(|cause| invalid(format!("Private media recovery: {cause:?}")))
}

fn copy_exact(
    source: &mut (impl Read + Seek),
    output: &mut File,
    expected: &MediaDigest,
) -> io::Result<()> {
    source.rewind()?;
    struct VerifiedCopy<'a> {
        file: &'a mut File,
        digest: Sha256,
    }
    impl Write for VerifiedCopy<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let written = self.file.write(bytes)?;
            self.digest.update(&bytes[..written]);
            Ok(written)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }
    let mut copy = VerifiedCopy {
        file: output,
        digest: Sha256::new(),
    };
    let size = io::copy(&mut source.take(expected.size + 1), &mut copy)?;
    if size != expected.size || format!("{:x}", copy.digest.finalize()) != expected.hash {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Media bytes changed during publication",
        ));
    }
    Ok(())
}

fn verify_target(
    project: &OpenProject,
    path: &str,
    directory: &File,
    expected: Option<&MediaDigest>,
    protection: &Protection,
) -> Result<(), CreationError> {
    validate_identity(project, protection)?;
    let (current, name) = media_target(project, path)?;
    let held = directory.metadata().map_err(io_error)?;
    let metadata = current.metadata().map_err(io_error)?;
    if metadata.ino() != held.ino()
        || metadata.dev() != held.dev()
        || open_media_at(&current, &name)?
            .as_ref()
            .map(|(_, digest)| digest)
            != expected
    {
        return Err(conflict(path));
    }
    Ok(())
}

impl CreationAccess {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn publish_assistant_media(
        project: &OpenProject,
        journal: &mut Journal,
        path: &str,
        mut source: impl Read + Seek,
        after: MediaDigest,
        version: String,
        expected: Option<&MediaDigest>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        if journal.entries.len() + journal.artifacts.len() + journal.media_artifacts.len() >= 64
            || journal
                .media_artifacts
                .iter()
                .any(|entry| entry.path.eq_ignore_ascii_case(path))
        {
            return Err(invalid(
                "This media path already has a Work recovery record or the journal is full",
            ));
        }
        let (directory, name) = media_target(project, path)?;
        let current = open_media_at(&directory, &name)?;
        if current.as_ref().map(|(_, digest)| digest) != expected {
            return Err(conflict(path));
        }
        let (before, backup, permissions) = if let Some((mut file, before)) = current {
            let mode = file.metadata().map_err(io_error)?.permissions().mode() & 0o777;
            let backup_directory = backup_directory(project)?;
            let key = format!("{:x}", Sha256::digest(path.as_bytes()));
            let backup = format!("{}-{key}", journal.id);
            documents::publish_file(&backup_directory, &backup, |output| {
                copy_exact(&mut file, output, &before)
            })
            .map_err(|cause| invalid(format!("Cannot save original media: {cause:?}")))?;
            (Some(before), Some(backup), mode)
        } else {
            (None, None, 0o644)
        };
        journal.media_artifacts.push(MediaArtifact {
            path: path.into(),
            before,
            after,
            backup,
            permissions,
            version: Some(version),
            publishing: true,
            undoing: false,
            undone: false,
        });
        journal.persist(data)?;
        let entry = journal.media_artifacts.last().expect("recorded audio");
        let permissions = fs::Permissions::from_mode(entry.permissions);
        let policy = if entry.before.is_some() {
            PublishPolicy::Replace { permissions }
        } else {
            PublishPolicy::Create {
                permissions: CreatePermissions::Exact(permissions),
            }
        };
        let published = publish_stream_at(
            &directory,
            &name,
            policy,
            |output| copy_exact(&mut source, output, &entry.after),
            || verify_target(project, path, &directory, entry.before.as_ref(), protection),
        )?;
        if published.state == PublicationState::Occupied {
            return Err(conflict(path));
        }
        journal
            .media_artifacts
            .last_mut()
            .expect("recorded audio")
            .publishing = false;
        journal.persist(data)
    }

    pub(super) fn reconcile_media_artifacts(
        project: &OpenProject,
        journal: &mut Journal,
    ) -> Result<(), CreationError> {
        let mut remove = Vec::new();
        for (index, entry) in journal.media_artifacts.iter_mut().enumerate() {
            if !entry.publishing && !entry.undoing {
                continue;
            }
            let current = media_digest(project, &entry.path)?;
            if entry.undoing {
                if current == entry.before {
                    entry.undone = true;
                    entry.undoing = false;
                } else if current.as_ref() == Some(&entry.after) {
                    entry.undoing = false;
                } else {
                    return Err(conflict(&entry.path));
                }
            }
            if entry.publishing {
                if current.as_ref() == Some(&entry.after) {
                    entry.publishing = false;
                } else if current == entry.before {
                    remove.push(index);
                } else {
                    return Err(conflict(&entry.path));
                }
            }
        }
        for index in remove.into_iter().rev() {
            let entry = &journal.media_artifacts[index];
            if let Some(backup) = &entry.backup {
                documents::unlink(&backup_directory(project)?, backup)
                    .map_err(|cause| invalid(format!("Private media cleanup: {cause:?}")))?;
            }
            journal.media_artifacts.remove(index);
        }
        Ok(())
    }

    pub(super) fn verified_media_artifacts(
        project: &OpenProject,
        journal: &Journal,
    ) -> Result<Vec<AssistantTaskResumeFile>, CreationError> {
        journal
            .media_artifacts
            .iter()
            .map(|entry| {
                if entry.undone
                    || entry.publishing
                    || entry.undoing
                    || media_digest(project, &entry.path)?.as_ref() != Some(&entry.after)
                {
                    return Err(conflict(&entry.path));
                }
                Ok(AssistantTaskResumeFile {
                    path: entry.path.clone(),
                    version: Some(entry.version().to_owned()),
                })
            })
            .collect()
    }

    pub(super) fn validate_media_undo(
        project: &OpenProject,
        journal: &Journal,
        path: Option<&str>,
    ) -> Result<(), CreationError> {
        for entry in journal
            .media_artifacts
            .iter()
            .filter(|entry| !entry.undone && path.is_none_or(|path| path == entry.path))
        {
            if media_digest(project, &entry.path)?.as_ref() != Some(&entry.after) {
                return Err(conflict(&entry.path));
            }
            if let Some(backup) = &entry.backup {
                let directory = backup_directory(project)?;
                let name =
                    CString::new(backup.as_str()).map_err(|_| invalid("Invalid audio backup"))?;
                if open_media_at(&directory, &name)?.map(|(_, digest)| digest) != entry.before {
                    return Err(conflict(&entry.path));
                }
            }
        }
        Ok(())
    }

    pub(super) fn undo_media_artifacts(
        project: &OpenProject,
        journal: &mut Journal,
        path: Option<&str>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        for index in 0..journal.media_artifacts.len() {
            if journal.media_artifacts[index].undone
                || path.is_some_and(|path| path != journal.media_artifacts[index].path)
            {
                continue;
            }
            journal.media_artifacts[index].undoing = true;
            journal.persist(data)?;
            let entry = &journal.media_artifacts[index];
            let (directory, name) = media_target(project, &entry.path)?;
            let verify = || {
                verify_target(
                    project,
                    &entry.path,
                    &directory,
                    Some(&entry.after),
                    protection,
                )
            };
            if let (Some(backup), Some(before)) = (&entry.backup, &entry.before) {
                let backups = backup_directory(project)?;
                let backup =
                    CString::new(backup.as_str()).map_err(|_| invalid("Invalid audio backup"))?;
                let (mut saved, actual) =
                    open_media_at(&backups, &backup)?.ok_or_else(|| conflict(&entry.path))?;
                if &actual != before {
                    return Err(conflict(&entry.path));
                }
                publish_stream_at(
                    &directory,
                    &name,
                    PublishPolicy::Replace {
                        permissions: fs::Permissions::from_mode(entry.permissions),
                    },
                    |output| copy_exact(&mut saved, output, before),
                    verify,
                )?;
            } else {
                verify()?;
                if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                    return Err(io_error(io::Error::last_os_error()));
                }
            }
            directory.sync_all().map_err(io_error)?;
            journal.media_artifacts[index].undone = true;
            journal.media_artifacts[index].undoing = false;
            journal.persist(data)?;
        }
        Ok(())
    }
}
