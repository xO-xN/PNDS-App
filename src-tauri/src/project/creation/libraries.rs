//! Shared library adoption is a single guarded manifest replacement.
use super::*;
use crate::project::manifest::{parse_manifest, SharedLibraryReference};
use crate::project::shared_libraries::{LibraryCatalog, SharedLibraryKind, SharedLibrarySource};
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationLibrary {
    pub id: String,
    pub version: String,
    pub kind: SharedLibraryKind,
    pub source: SharedLibrarySource,
    pub referenced_version: Option<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationLibraryCatalog {
    pub libraries: Vec<CreationLibrary>,
    pub manifest_version: String,
    pub project_version: String,
}

#[derive(Debug, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationLibraryAdoption {
    pub id: String,
    pub version: String,
    pub project_version: String,
    pub manifest_version: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationLibraryResult {
    pub manifest_version: String,
    pub already_added: bool,
}

fn library_error(detail: String) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

fn manifest_file(project: &OpenProject) -> Result<File, CreationError> {
    // A root manifest symlink is refused for adoption, even if its target is internal.
    let fd = unsafe {
        libc::openat(
            project.directory.as_raw_fd(),
            c"manifest.json".as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

impl CreationAccess {
    pub fn library_catalog(
        &self,
        identity: &str,
        resources: &Path,
        protection: &Protection,
    ) -> Result<CreationLibraryCatalog, CreationError> {
        let project = self.current(identity, protection)?;
        let bytes = bounded_read(manifest_file(project)?, TEXT_MAX_BYTES)?;
        let manifest = parse_manifest(std::str::from_utf8(&bytes).map_err(|error| {
            CreationError::new(CreationErrorCode::InvalidUtf8, error.to_string())
        })?)
        .map_err(|detail| CreationError::new(CreationErrorCode::ManifestInvalid, detail))?;
        let catalog = LibraryCatalog::load(resources).map_err(library_error)?;
        let references: Vec<_> = catalog
            .libraries
            .iter()
            .map(|library| SharedLibraryReference {
                id: library.id.clone(),
                version: library.version.clone(),
            })
            .collect();
        catalog
            .resolve(resources, &references)
            .map_err(library_error)?;
        Ok(CreationLibraryCatalog {
            libraries: catalog
                .libraries
                .into_iter()
                .map(|library| CreationLibrary {
                    referenced_version: manifest
                        .shared_libraries
                        .iter()
                        .find(|reference| reference.id == library.id)
                        .map(|reference| reference.version.clone()),
                    id: library.id,
                    version: library.version,
                    kind: library.kind,
                    source: library.source,
                })
                .collect(),
            manifest_version: file_version(&bytes),
            project_version: manifest.version,
        })
    }

    pub fn adopt_library(
        &self,
        identity: &str,
        adoption: &CreationLibraryAdoption,
        resources: &Path,
        protection: &Protection,
    ) -> Result<CreationLibraryResult, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let file = manifest_file(project)?;
        let permissions = file.metadata().map_err(io_error)?.permissions();
        let bytes = bounded_read(file, TEXT_MAX_BYTES)?;
        if file_version(&bytes) != adoption.manifest_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "manifest.json",
            ));
        }
        let mut value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| {
            CreationError::new(CreationErrorCode::ManifestInvalid, error.to_string())
        })?;
        let mut manifest = parse_manifest(std::str::from_utf8(&bytes).map_err(|error| {
            CreationError::new(CreationErrorCode::InvalidUtf8, error.to_string())
        })?)
        .map_err(|detail| CreationError::new(CreationErrorCode::ManifestInvalid, detail))?;
        let reference = SharedLibraryReference {
            id: adoption.id.clone(),
            version: adoption.version.clone(),
        };
        crate::project::shared_libraries::resolve_at(resources, std::slice::from_ref(&reference))
            .map_err(library_error)?;
        if manifest.shared_libraries.contains(&reference) {
            return Ok(CreationLibraryResult {
                manifest_version: adoption.manifest_version.clone(),
                already_added: true,
            });
        }
        let next = adoption.project_version.trim();
        if next.is_empty() || next == manifest.version {
            return Err(CreationError::new(
                CreationErrorCode::ManifestInvalid,
                "Adopting an App shared package requires a new non-empty project version",
            ));
        }
        manifest
            .shared_libraries
            .retain(|existing| existing.id != reference.id);
        manifest.shared_libraries.push(reference);
        value["schemaVersion"] = serde_json::json!(2);
        value["sharedLibraries"] =
            serde_json::to_value(manifest.shared_libraries).expect("serializable references");
        value["version"] = serde_json::json!(next);
        let text = serde_json::to_string_pretty(&value).expect("serializable manifest") + "\n";
        if text.len() as u64 > TEXT_MAX_BYTES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "manifest.json",
            ));
        }
        parse_manifest(&text)
            .map_err(|detail| CreationError::new(CreationErrorCode::ManifestInvalid, detail))?;
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let temp = CString::new(format!(".pnds-save-libraries-{pid}-{serial}.tmp"))
            .expect("generated path");
        let fd = project.directory.as_raw_fd();
        let temporary = unsafe {
            libc::openat(
                fd,
                temp.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if temporary < 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        let mut temporary = unsafe { File::from_raw_fd(temporary) };
        let result = (|| {
            temporary.write_all(text.as_bytes()).map_err(io_error)?;
            temporary
                .set_permissions(fs::Permissions::from_mode(permissions.mode()))
                .map_err(io_error)?;
            temporary.sync_all().map_err(io_error)?;
            validate_identity(project, protection)?;
            if file_version(&bounded_read(manifest_file(project)?, TEXT_MAX_BYTES)?)
                != adoption.manifest_version
            {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "manifest.json",
                ));
            }
            if unsafe { libc::renameat(fd, temp.as_ptr(), fd, c"manifest.json".as_ptr()) } != 0 {
                return Err(io_error(io::Error::last_os_error()));
            }
            Ok(CreationLibraryResult {
                manifest_version: file_version(text.as_bytes()),
                already_added: false,
            })
        })();
        unsafe {
            libc::unlinkat(fd, temp.as_ptr(), 0);
        }
        result
    }
}
