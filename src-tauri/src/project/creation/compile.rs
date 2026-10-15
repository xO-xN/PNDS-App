//! Compilation has three phases: trusted inputs, an unlocked controlled process,
//! then capability/version-checked publication. No runtime operation is implied.
use super::*;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SynthdefReferenceStatus {
    Verified,
    Missing,
    Invalid,
    NotChecked,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SynthdefReferenceCheck {
    pub path: String,
    pub status: SynthdefReferenceStatus,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SynthdefCompileReport {
    pub sclang_path: Option<String>,
    pub produced: Vec<String>,
    pub references: Vec<SynthdefReferenceCheck>,
    pub output: String,
    pub error: Option<String>,
}

/// Process dependencies are injected at the trusted workflow seam in tests.
pub struct SynthdefCompiler {
    pub sclang: Result<PathBuf, String>,
    pub timeout: Duration,
}

impl Default for SynthdefCompiler {
    fn default() -> Self {
        Self {
            sclang: crate::project::synthdef::find_sclang(),
            timeout: Duration::from_secs(120),
        }
    }
}

pub struct SynthdefCompileJob {
    identity: String,
    root: PathBuf,
    inputs: BTreeMap<String, String>,
    sources: Vec<PathBuf>,
    artifacts: BTreeMap<String, String>,
    report: SynthdefCompileReport,
}

pub struct SynthdefCompileOutput {
    job: SynthdefCompileJob,
    staging: Option<tempfile::TempDir>,
}

impl CreationAccess {
    pub fn prepare_synthdefs(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<SynthdefCompileJob, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let bytes = bounded_read(project.file("manifest.json")?, TEXT_MAX_BYTES)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|e| CreationError::new(CreationErrorCode::InvalidUtf8, e.to_string()))?;
        let manifest = crate::project::manifest::parse_manifest(text)
            .map_err(|e| CreationError::new(CreationErrorCode::ManifestInvalid, e))?;
        let mut inputs = BTreeMap::from([("manifest.json".into(), file_version(&bytes))]);
        let mut sources = Vec::new();
        let mut names = directory_names(project.file("supercollider/source")?)?;
        names.sort();
        for name in names {
            if Path::new(&name).extension().is_none_or(|ext| ext != "scd") {
                continue;
            }
            let path = format!("supercollider/source/{}", name.to_string_lossy());
            let bytes = bounded_read(project.file(&path)?, TEXT_MAX_BYTES)?;
            inputs.insert(path.clone(), file_version(&bytes));
            sources.push(project.resolve(&path)?);
        }
        if sources.is_empty() {
            return Err(CreationError::new(
                CreationErrorCode::Missing,
                "supercollider/source/ contains no .scd files to compile",
            ));
        }
        Ok(SynthdefCompileJob {
            identity: identity.into(),
            root: project.root.clone(),
            inputs,
            sources,
            artifacts: artifact_versions(project)?,
            report: SynthdefCompileReport {
                sclang_path: None,
                produced: Vec::new(),
                references: manifest
                    .audio
                    .synthdefs
                    .unwrap_or_default()
                    .into_iter()
                    .map(|path| SynthdefReferenceCheck {
                        path,
                        status: SynthdefReferenceStatus::NotChecked,
                        detail: None,
                    })
                    .collect(),
                output: String::new(),
                error: None,
            },
        })
    }

    pub fn finish_synthdefs(
        &self,
        mut output: SynthdefCompileOutput,
        protection: &Protection,
    ) -> Result<SynthdefCompileReport, CreationError> {
        let project = self.current(&output.job.identity, protection)?;
        ensure_editable(project)?;
        if output.job.report.error.is_some() {
            return Ok(output.job.report);
        }
        let current = self.prepare_synthdefs(&output.job.identity, protection)?;
        if current.inputs != output.job.inputs
            || current.sources != output.job.sources
            || current.artifacts != output.job.artifacts
        {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Compile inputs or artifacts changed; save or reload and compile again",
            ));
        }
        let staging = output.staging.as_ref().expect("successful run has staging");
        if let Err(error) =
            publish_outputs(project, staging.path(), &mut output.job.report, protection)
        {
            // The compiler did run: keep its output, all declarations and any
            // files already published instead of reducing this to an IPC error.
            output.job.report.error = Some(error.detail);
            return Ok(output.job.report);
        }
        for reference in &mut output.job.report.references {
            match project
                .file(&reference.path)
                .and_then(|file| bounded_read(file, IMAGE_MAX_BYTES))
            {
                Ok(bytes) => {
                    let name = Path::new(&reference.path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy();
                    match validate_artifact(&name, &bytes) {
                        Ok(()) => reference.status = SynthdefReferenceStatus::Verified,
                        Err(error) => {
                            reference.status = SynthdefReferenceStatus::Invalid;
                            reference.detail = Some(error);
                        }
                    }
                }
                Err(error) => {
                    reference.status = if error.code == CreationErrorCode::Missing {
                        SynthdefReferenceStatus::Missing
                    } else {
                        SynthdefReferenceStatus::Invalid
                    };
                    reference.detail = Some(error.detail);
                }
            }
        }
        if output
            .job
            .report
            .references
            .iter()
            .any(|reference| reference.status != SynthdefReferenceStatus::Verified)
        {
            output.job.report.error = Some("Compiled artifacts do not satisfy every manifest.audio.synthdefs reference: SynthDef name = file name = manifest reference".into());
        }
        Ok(output.job.report)
    }
}

impl SynthdefCompileJob {
    pub fn run(self, compiler: &SynthdefCompiler) -> SynthdefCompileOutput {
        self.run_cancellable(compiler, &std::sync::atomic::AtomicBool::new(false))
    }

    /// Same validated compile workflow, cancellable by a task owner.
    pub fn run_cancellable(
        mut self,
        compiler: &SynthdefCompiler,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> SynthdefCompileOutput {
        let mut staging = None;
        let result = (|| {
            let sclang = compiler.sclang.as_ref().map_err(Clone::clone)?;
            self.report.sclang_path = Some(sclang.display().to_string());
            let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
            let result = crate::project::synthdef::run_sclang(
                &self.root,
                &self.sources,
                directory.path(),
                sclang,
                compiler.timeout,
                cancelled,
            );
            staging = Some(directory);
            result
        })();
        match result {
            Ok(text) => self.report.output = text,
            Err(error) => self.report.error = Some(error),
        }
        SynthdefCompileOutput { job: self, staging }
    }
}

fn publish_outputs(
    project: &OpenProject,
    staging: &Path,
    report: &mut SynthdefCompileReport,
    protection: &Protection,
) -> Result<(), CreationError> {
    let mut artifacts = BTreeMap::new();
    for entry in fs::read_dir(staging).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        if entry.path().extension().is_none_or(|ext| ext != "scsyndef") {
            continue;
        }
        if !entry.file_type().map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Compiler output must be a regular SynthDef file",
            ));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(entry.path())
            .map_err(io_error)?;
        let bytes = bounded_read(file, IMAGE_MAX_BYTES)?;
        if let Err(error) = validate_artifact(&name, &bytes) {
            return Err(CreationError::new(CreationErrorCode::InvalidProject, error));
        }
        artifacts.insert(name, bytes);
    }
    if artifacts.is_empty() {
        return Err(CreationError::new(CreationErrorCode::Missing, "sclang reported success but produced no .scsyndef artifacts (sources must register SynthDefs with .add)"));
    }
    let directory = artifact_directory(project)?;
    for (name, bytes) in artifacts {
        validate_identity(project, protection)?;
        let actual = project
            .file("supercollider/synthdefs")?
            .metadata()
            .map_err(io_error)?;
        let held = directory.metadata().map_err(io_error)?;
        if actual.dev() != held.dev() || actual.ino() != held.ino() {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "SynthDef output directory changed",
            ));
        }
        publish_artifact(&directory, &name, &bytes)?;
        report.produced.push(name);
    }
    Ok(())
}

// SuperCollider's documented big-endian SCgf header: version, definition
// count, then a length-prefixed name. writeDefFile emits one named definition.
fn validate_artifact(name: &str, bytes: &[u8]) -> Result<(), String> {
    let length = bytes.get(10).copied().unwrap_or(0) as usize;
    let symbol = bytes
        .get(11..11 + length)
        .and_then(|bytes| std::str::from_utf8(bytes).ok());
    if bytes.get(..4) != Some(b"SCgf")
        || !matches!(bytes.get(4..8), Some([0, 0, 0, 1] | [0, 0, 0, 2]))
        || bytes.get(8..10) != Some(&[0, 1])
        || length == 0
        || symbol.map(|symbol| format!("{symbol}.scsyndef")).as_deref() != Some(name)
    {
        return Err(format!("{name}: invalid SynthDef header or embedded name does not match the artifact file name"));
    }
    Ok(())
}

fn open_at(
    directory: &File,
    name: &CStr,
    flags: i32,
    mode: libc::mode_t,
) -> Result<File, CreationError> {
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            mode as libc::c_uint,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return Err(
            if matches!(error.raw_os_error(), Some(libc::ELOOP | libc::ENOTDIR)) {
                CreationError::new(CreationErrorCode::PathEscape, "SynthDef output must stay in the project's real supercollider/synthdefs directory")
            } else {
                io_error(error)
            },
        );
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn artifact_versions(project: &OpenProject) -> Result<BTreeMap<String, String>, CreationError> {
    let parent = open_at(
        &project.directory,
        c"supercollider",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )?;
    let directory = match open_at(&parent, c"synthdefs", libc::O_RDONLY | libc::O_DIRECTORY, 0) {
        Ok(directory) => directory,
        Err(error) if error.code == CreationErrorCode::Missing => return Ok(BTreeMap::new()),
        Err(error) => return Err(error),
    };
    let mut versions = BTreeMap::new();
    for name in directory_names(directory.try_clone().map_err(io_error)?)? {
        if Path::new(&name)
            .extension()
            .is_some_and(|ext| ext == "scsyndef")
        {
            let name = CString::new(name.as_bytes()).map_err(|_| {
                CreationError::new(CreationErrorCode::PathEscape, "Invalid artifact name")
            })?;
            let bytes = bounded_read(
                open_at(&directory, &name, libc::O_RDONLY, 0)?,
                IMAGE_MAX_BYTES,
            )?;
            versions.insert(name.to_string_lossy().into_owned(), file_version(&bytes));
        }
    }
    Ok(versions)
}

fn artifact_directory(project: &OpenProject) -> Result<File, CreationError> {
    let parent = open_at(
        &project.directory,
        c"supercollider",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )?;
    if unsafe { libc::mkdirat(parent.as_raw_fd(), c"synthdefs".as_ptr(), 0o755) } != 0 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(io_error(error));
        }
    }
    open_at(&parent, c"synthdefs", libc::O_RDONLY | libc::O_DIRECTORY, 0)
}

fn publish_artifact(directory: &File, name: &str, bytes: &[u8]) -> Result<(), CreationError> {
    let target =
        CString::new(name).map_err(|_| CreationError::new(CreationErrorCode::PathEscape, name))?;
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temp = CString::new(format!(".pnds-save-{pid}-{serial}.tmp")).expect("generated name");
    let mut file = open_at(
        directory,
        &temp,
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        0o644,
    )?;
    let result = (|| {
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                temp.as_ptr(),
                directory.as_raw_fd(),
                target.as_ptr(),
            )
        } != 0
        {
            return Err(io_error(io::Error::last_os_error()));
        }
        Ok(())
    })();
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), temp.as_ptr(), 0);
    }
    result
}
