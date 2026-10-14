//! Bounded, isolated Git reads. A job holds the issued root while processes run
//! outside the access mutex; completion revalidates the capability.
use super::*;
use std::os::unix::process::CommandExt;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitState {
    Available,
    GitUnavailable,
    NotRepository,
    Unreadable,
    TooLarge,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitChange {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub index_status: String,
    pub disk_status: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitStatus {
    pub state: GitState,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub changes: Vec<CreationGitChange>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffLayer {
    Staged,
    Unstaged,
    Untracked,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitDiffState {
    Text,
    Binary,
    Unreadable,
    TooLarge,
    Unavailable,
    Timeout,
    NoChange,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationGitDiff {
    pub state: GitDiffState,
    pub text: Option<String>,
    pub detail: Option<String>,
}
pub struct GitDiffJob {
    identity: String,
    directory: File,
    path: String,
    layer: GitDiffLayer,
    untracked: Option<File>,
}
pub struct GitDiffOutput {
    identity: String,
    report: CreationGitDiff,
}

pub struct GitReader {
    pub executable: PathBuf,
    pub timeout: Duration,
    pub max_bytes: usize,
    pub(super) disabled_filters: Vec<String>,
}
impl Default for GitReader {
    fn default() -> Self {
        Self {
            executable: [
                "/Library/Developer/CommandLineTools/usr/bin/git",
                "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
                "/opt/homebrew/bin/git",
                "/usr/local/bin/git",
            ]
            .into_iter()
            .map(PathBuf::from)
            .find(|path| {
                path.is_file()
                    && fs::canonicalize(path)
                        .is_ok_and(|resolved| resolved != Path::new("/usr/bin/git"))
            })
            .unwrap_or_else(|| PathBuf::from("/nonexistent/pnds-git")),
            timeout: Duration::from_secs(5),
            max_bytes: TEXT_MAX_BYTES as usize,
            disabled_filters: Vec::new(),
        }
    }
}
pub struct GitStatusJob {
    identity: String,
    directory: File,
}
pub struct GitStatusOutput {
    identity: String,
    report: CreationGitStatus,
}
struct GitFailure {
    state: GitState,
    detail: String,
}
type GitResult<T> = Result<T, GitFailure>;

impl CreationAccess {
    pub fn prepare_git_status(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GitStatusJob, CreationError> {
        let project = self.current(identity, protection)?;
        Ok(GitStatusJob {
            identity: identity.into(),
            directory: project.directory.try_clone().map_err(io_error)?,
        })
    }
    pub fn finish_git_status(
        &self,
        output: GitStatusOutput,
        protection: &Protection,
    ) -> Result<CreationGitStatus, CreationError> {
        self.current(&output.identity, protection)?;
        Ok(output.report)
    }
}
impl CreationAccess {
    pub fn prepare_git_diff(
        &self,
        identity: &str,
        path: &str,
        layer: GitDiffLayer,
        protection: &Protection,
    ) -> Result<GitDiffJob, CreationError> {
        let project = self.current(identity, protection)?;
        if path.is_empty() || !safe_relative(path) {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "Git diff must stay inside this project",
            ));
        }
        // Existing working-tree paths must satisfy the same containment as file
        // reading. Missing paths remain valid for staged/unstaged deletions.
        let untracked = match project.file(path) {
            Ok(file) if layer == GitDiffLayer::Untracked => Some(file),
            Ok(_) => None,
            Err(error) if error.code == CreationErrorCode::Missing => None,
            Err(error) => return Err(error),
        };
        if layer == GitDiffLayer::Untracked
            && fs::symlink_metadata(project.root.join(path))
                .is_ok_and(|metadata| metadata.is_symlink())
        {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "Untracked Git previews do not follow symbolic links",
            ));
        }
        Ok(GitDiffJob {
            identity: identity.into(),
            directory: project.directory.try_clone().map_err(io_error)?,
            path: path.into(),
            layer,
            untracked,
        })
    }
    pub fn finish_git_diff(
        &self,
        output: GitDiffOutput,
        protection: &Protection,
    ) -> Result<CreationGitDiff, CreationError> {
        self.current(&output.identity, protection)?;
        Ok(output.report)
    }
}
impl GitDiffJob {
    pub fn run(self, reader: &GitReader) -> GitDiffOutput {
        let report = reader
            .isolated(&self.directory)
            .and_then(|reader| self.inspect(&reader))
            .unwrap_or_else(|error| CreationGitDiff {
                state: match error.state {
                    GitState::TooLarge => GitDiffState::TooLarge,
                    GitState::Timeout => GitDiffState::Timeout,
                    GitState::GitUnavailable | GitState::NotRepository => GitDiffState::Unavailable,
                    _ => GitDiffState::Unreadable,
                },
                text: None,
                detail: Some(error.detail),
            });
        GitDiffOutput {
            identity: self.identity,
            report,
        }
    }
    fn inspect(&self, reader: &GitReader) -> GitResult<CreationGitDiff> {
        let status = inspect_status(&self.directory, reader)?;
        let present = status.changes.iter().any(|change| {
            change.path == self.path
                && match self.layer {
                    GitDiffLayer::Staged => change.staged,
                    GitDiffLayer::Unstaged => change.unstaged,
                    GitDiffLayer::Untracked => change.untracked,
                }
        });
        if !present {
            return Ok(CreationGitDiff {
                state: GitDiffState::NoChange,
                text: None,
                detail: None,
            });
        }
        if self.layer == GitDiffLayer::Untracked {
            let file = self
                .untracked
                .as_ref()
                .ok_or_else(|| unreadable("Untracked file is no longer readable"))?;
            if !file
                .metadata()
                .map_err(|error| unreadable(error.to_string()))?
                .is_file()
            {
                return Err(unreadable("Untracked preview requires a regular file"));
            }
            let bytes = bounded_read(
                file.try_clone()
                    .map_err(|error| unreadable(error.to_string()))?,
                TEXT_MAX_BYTES,
            )
            .map_err(|error| GitFailure {
                state: if error.code == CreationErrorCode::TooLarge {
                    GitState::TooLarge
                } else {
                    GitState::Unreadable
                },
                detail: error.detail,
            })?;
            if bytes.contains(&0) {
                return Ok(CreationGitDiff {
                    state: GitDiffState::Binary,
                    text: None,
                    detail: None,
                });
            }
            let raw = decode(bytes)?;
            let text = format!(
                "--- /dev/null\n+++ {}\n{}",
                self.path,
                raw.split_inclusive('\n')
                    .map(|line| format!("+{line}"))
                    .collect::<String>()
            );
            if text.len() > TEXT_MAX_BYTES as usize {
                return Err(GitFailure {
                    state: GitState::TooLarge,
                    detail: "Untracked preview exceeds 1 MiB".into(),
                });
            }
            return Ok(CreationGitDiff {
                state: GitDiffState::Text,
                text: Some(text),
                detail: None,
            });
        }
        let literal = format!(":(literal){}", self.path);
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--no-color",
            "--ignore-submodules=all",
        ];
        if self.layer == GitDiffLayer::Staged {
            args.push("--cached");
        }
        args.extend(["--", &literal]);
        let text = reader.text(&self.directory, &args)?;
        let binary = text.lines().any(|line| line.starts_with("Binary files "));
        Ok(CreationGitDiff {
            state: if binary {
                GitDiffState::Binary
            } else if text.is_empty() {
                GitDiffState::NoChange
            } else {
                GitDiffState::Text
            },
            text: if binary || text.is_empty() {
                None
            } else {
                Some(text)
            },
            detail: None,
        })
    }
}
impl GitStatusJob {
    pub fn run(self, reader: &GitReader) -> GitStatusOutput {
        let report = reader
            .isolated(&self.directory)
            .and_then(|reader| inspect_status(&self.directory, &reader))
            .unwrap_or_else(|error| CreationGitStatus {
                state: error.state,
                branch: None,
                head: None,
                changes: vec![],
                detail: Some(error.detail),
            });
        GitStatusOutput {
            identity: self.identity,
            report,
        }
    }
}

fn inspect_status(directory: &File, reader: &GitReader) -> GitResult<CreationGitStatus> {
    let (exit, bytes, errors) =
        reader.run_raw(directory, &["rev-parse", "--is-inside-work-tree"])?;
    if !exit.success() || bytes != b"true\n" {
        return Err(GitFailure {
            state: if String::from_utf8_lossy(&errors)
                .contains("not a git repository (or any of the parent directories)")
            {
                GitState::NotRepository
            } else {
                GitState::Unreadable
            },
            detail: if errors.is_empty() {
                "This project is not inside a Git working tree".into()
            } else {
                String::from_utf8_lossy(&errors).trim().into()
            },
        });
    }
    let prefix = reader.text(directory, &["rev-parse", "--show-prefix"])?;
    let (branch_exit, branch) =
        reader.run(directory, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let (head_exit, head) = reader.run(directory, &["rev-parse", "--verify", "HEAD"])?;
    let (_, bytes) = reader.success(
        directory,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=all",
            "--",
            ".",
        ],
    )?;
    let mut changes = Vec::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        if record.len() < 4 || record[2] != b' ' {
            return Err(unreadable("Invalid Git status record"));
        }
        let raw =
            std::str::from_utf8(&record[3..]).map_err(|_| unreadable("Git path is not UTF-8"))?;
        let Some(path) = raw.strip_prefix(prefix.strip_suffix('\n').unwrap_or(&prefix)) else {
            continue;
        };
        if path.is_empty() || !safe_relative(path) {
            return Err(unreadable("Git returned an out-of-project path"));
        }
        if changes.len() >= MAX_ENTRIES {
            return Err(GitFailure {
                state: GitState::TooLarge,
                detail: "Git status exceeds 4096 files".into(),
            });
        }
        let untracked = record[..2] == *b"??";
        changes.push(CreationGitChange {
            path: path.into(),
            staged: !untracked && record[0] != b' ',
            unstaged: !untracked && record[1] != b' ',
            untracked,
            index_status: (record[0] as char).to_string(),
            disk_status: (record[1] as char).to_string(),
        });
    }
    Ok(CreationGitStatus {
        state: GitState::Available,
        branch: if branch_exit.success() {
            Some(decode(branch)?.trim().into())
        } else {
            None
        },
        head: if head_exit.success() {
            Some(decode(head)?.trim().into())
        } else {
            None
        },
        changes,
        detail: None,
    })
}
fn safe_relative(path: &str) -> bool {
    !Path::new(path).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) || component.as_os_str() == ".git"
    })
}
fn unreadable(detail: impl Into<String>) -> GitFailure {
    GitFailure {
        state: GitState::Unreadable,
        detail: detail.into(),
    }
}
fn decode(bytes: Vec<u8>) -> GitResult<String> {
    String::from_utf8(bytes).map_err(|_| unreadable("Git text is not UTF-8"))
}

impl GitReader {
    fn isolated(&self, directory: &File) -> GitResult<Self> {
        // Object reads can hydrate partial clones even on Git versions that
        // ignore GIT_NO_LAZY_FETCH. Reject their configuration before any
        // status/diff read; discover and neutralize filters without helpers.
        let (exit, bytes) = self.run(
            directory,
            &[
                "config",
                "--includes",
                "--null",
                "--name-only",
                "--get-regexp",
                "^(filter\\.|extensions\\.partialclone$|remote\\..*\\.(promisor|partialclonefilter)$)",
            ],
        )?;
        if !exit.success() && exit.code() != Some(1) {
            return Err(unreadable("Git configuration is unreadable"));
        }
        let mut drivers = std::collections::BTreeSet::new();
        for key in bytes.split(|byte| *byte == 0).filter(|key| !key.is_empty()) {
            let key = std::str::from_utf8(key)
                .map_err(|_| unreadable("Git inspection configuration is not UTF-8"))?;
            if key == "extensions.partialclone" || key.starts_with("remote.") {
                return Err(unreadable(
                    "Read-only inspection cannot read partial clone repositories with potentially missing objects. Complete the repository using an external Git tool first.",
                ));
            }
            if let Some((driver, _)) = key
                .strip_prefix("filter.")
                .and_then(|key| key.rsplit_once('.'))
            {
                drivers.insert(driver.to_owned());
            }
        }
        Ok(Self {
            executable: self.executable.clone(),
            timeout: self.timeout,
            max_bytes: self.max_bytes,
            disabled_filters: drivers.into_iter().collect(),
        })
    }
    fn text(&self, directory: &File, args: &[&str]) -> GitResult<String> {
        let (_, bytes) = self.success(directory, args)?;
        decode(bytes)
    }
    fn success(&self, directory: &File, args: &[&str]) -> GitResult<(ExitStatus, Vec<u8>)> {
        let (exit, bytes) = self.run(directory, args)?;
        if !exit.success() {
            return Err(unreadable("Git could not read this project"));
        }
        Ok((exit, bytes))
    }
    fn run(&self, directory: &File, args: &[&str]) -> GitResult<(ExitStatus, Vec<u8>)> {
        let (exit, bytes, _) = self.run_raw(directory, args)?;
        Ok((exit, bytes))
    }
    fn run_raw(
        &self,
        directory: &File,
        args: &[&str],
    ) -> GitResult<(ExitStatus, Vec<u8>, Vec<u8>)> {
        let mut command = Command::new(&self.executable);
        command
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LC_ALL", "C")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_NO_LAZY_FETCH", "1")
            // Deny every transport, including local files and external helpers,
            // even if configuration changes after the partial-clone probe.
            .env("GIT_ALLOW_PROTOCOL", "")
            .args([
                "--no-optional-locks",
                "--no-pager",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.untrackedCache=false",
                "-c",
                "status.renames=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        for driver in &self.disabled_filters {
            for setting in ["clean", "smudge", "process"] {
                command.args(["-c", &format!("filter.{driver}.{setting}=")]);
            }
            command.args(["-c", &format!("filter.{driver}.required=false")]);
        }
        command.args(args);
        let fd = directory.as_raw_fd();
        // SAFETY: the held root descriptor remains live until the child has
        // executed. fchdir uses no allocations or locks after fork.
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(fd) != 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut child = command.spawn().map_err(|error| GitFailure {
            state: if error.kind() == io::ErrorKind::NotFound {
                GitState::GitUnavailable
            } else {
                GitState::Unreadable
            },
            detail: error.to_string(),
        })?;
        let exceeded = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let output = capture_pipe(
            child.stdout.take().expect("piped stdout"),
            self.max_bytes,
            exceeded.clone(),
        );
        let errors = capture_pipe(
            child.stderr.take().expect("piped stderr"),
            self.max_bytes,
            exceeded.clone(),
        );
        let started = Instant::now();
        let exit = loop {
            if exceeded.load(Ordering::Acquire) {
                break Err(GitFailure {
                    state: GitState::TooLarge,
                    detail: "Git output exceeds the read limit".into(),
                });
            }
            match child.try_wait() {
                Ok(Some(exit)) => break Ok(exit),
                Ok(None) if started.elapsed() < self.timeout => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Ok(None) => {
                    break Err(GitFailure {
                        state: GitState::Timeout,
                        detail: "Git read timed out".into(),
                    })
                }
                Err(error) => break Err(unreadable(error.to_string())),
            }
        };
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
        let (read, bytes) = output
            .join()
            .map_err(|_| unreadable("Git output reader failed"))?;
        read.map_err(|error| unreadable(error.to_string()))?;
        let (read_errors, errors) = errors
            .join()
            .map_err(|_| unreadable("Git error reader failed"))?;
        read_errors.map_err(|error| unreadable(error.to_string()))?;
        if exceeded.load(Ordering::Acquire) {
            return Err(GitFailure {
                state: GitState::TooLarge,
                detail: "Git output exceeds the read limit".into(),
            });
        }
        Ok((exit?, bytes, errors))
    }
}

fn capture_pipe(
    pipe: impl Read + Send + 'static,
    limit: usize,
    exceeded: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> std::thread::JoinHandle<(io::Result<usize>, Vec<u8>)> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = pipe.take(limit as u64 + 1).read_to_end(&mut bytes);
        if bytes.len() > limit {
            exceeded.store(true, Ordering::Release);
        }
        (result, bytes)
    })
}
