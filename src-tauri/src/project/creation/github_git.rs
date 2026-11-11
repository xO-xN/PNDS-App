//! The GitHub transport operates on explicit branch refs and does not use
//! configured remotes, credentials, hooks, filters or Git executables.
use super::*;
use git2::{
    AutotagOption, Config, Cred, CredentialType, Direction, ErrorClass, ErrorCode, FetchOptions,
    Oid, ProxyOptions, PushOptions, RemoteCallbacks, RemoteRedirect, Repository,
    RepositoryInitOptions,
};
use std::cell::Cell;
use std::time::{Duration, Instant, UNIX_EPOCH};

const MAX_BIND_BRANCHES: usize = 256;
const MAX_TRANSFER_OBJECTS: usize = 100_000;
const MAX_TRANSFER_BYTES: usize = 512 * 1024 * 1024;
const TRANSFER_DEADLINE: Duration = Duration::from_secs(150);

/// # Safety
/// Call at application startup, before creating threads or using Git.
pub(crate) unsafe fn configure_github_git_timeouts() -> Result<(), git2::Error> {
    unsafe {
        git2::opts::set_server_connect_timeout_in_milliseconds(12_000)?;
        git2::opts::set_server_timeout_in_milliseconds(25_000)
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubLocalGit {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GithubGitRelation {
    NoLocalBranch,
    NewBranch,
    Equal,
    Ahead,
    Behind,
    Diverged,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubGitProbe {
    pub local: GithubLocalGit,
    pub remote_head: Option<String>,
    pub remote_empty: bool,
    pub shared_history: bool,
    pub relation: GithubGitRelation,
    pub ahead: u32,
    pub behind: u32,
}

pub(crate) struct GithubGitContext {
    root: PathBuf,
    directory: File,
}

impl CreationAccess {
    pub(crate) fn github_active_identity(&self) -> Option<&str> {
        self.project
            .as_ref()
            .map(|project| project.descriptor.identity.as_str())
    }

    pub(crate) fn github_context(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<GithubGitContext, CreationError> {
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        Ok(GithubGitContext {
            root: project.root.clone(),
            directory: project.directory.try_clone().map_err(io_error)?,
        })
    }

    pub(crate) fn github_fast_forward(
        &mut self,
        identity: &str,
        expected: &GithubGitProbe,
        data: &Path,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        if expected.relation != GithubGitRelation::Behind {
            return Err(conflict(
                "The current branch cannot fast-forward. Refresh GitHub status.",
            ));
        }
        let (branch, local, remote) = match (
            expected.local.branch.as_deref(),
            expected.local.head.as_deref(),
            expected.remote_head.as_deref(),
        ) {
            (Some(branch), Some(local), Some(remote)) => (branch, local, remote),
            _ => {
                return Err(conflict(
                    "The current or remote branch changed. Refresh GitHub status.",
                ))
            }
        };
        self.advance_git_branch(
            identity,
            (branch, parse_oid(local)?, parse_oid(remote)?),
            data,
            protection,
        )
    }
}

impl GithubGitContext {
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn directory_key(&self) -> Result<String, CreationError> {
        blank::check_directory_identity(&self.root, &self.directory)?;
        Ok(metadata_key(&self.directory.metadata().map_err(io_error)?))
    }

    fn repository(&self) -> Result<Option<Repository>, CreationError> {
        blank::check_directory_identity(&self.root, &self.directory)?;
        local_git::write_boundary(&self.root, false)
    }

    pub(crate) fn local(&self) -> Result<GithubLocalGit, CreationError> {
        match self.repository()? {
            Some(repo) => local_state(&repo),
            None => Ok(no_local_state()),
        }
    }

    pub(crate) fn probe(
        &self,
        repository: &str,
        token: Option<&str>,
        check_shared: bool,
    ) -> Result<GithubGitProbe, CreationError> {
        let url = github_url(repository)?;
        let repo = self.repository()?;
        let local = repo
            .as_ref()
            .map(local_state)
            .transpose()?
            .unwrap_or_else(no_local_state);
        let probe = match repo {
            Some(repo) if !check_shared => probe_repository(&repo, local, &url, token, false)?,
            other => {
                // A rejected binding must not import an unrelated repository
                // into the project's on-disk object store.
                let scratch = tempfile::tempdir().map_err(io_error)?;
                let staging = initialize(scratch.path(), "main", true)?;
                if let Some(repo) = &other {
                    seed_history_probe(repo, &staging)?;
                }
                probe_repository(&staging, local, &url, token, check_shared)?
            }
        };
        blank::check_directory_identity(&self.root, &self.directory)?;
        Ok(probe)
    }

    pub(crate) fn push(
        &self,
        repository: &str,
        token: &str,
        expected: &GithubGitProbe,
    ) -> Result<(), CreationError> {
        let url = github_url(repository)?;
        let repo = self
            .repository()?
            .ok_or_else(|| conflict("Save a local version before backing up."))?;
        push_repository(&repo, &url, Some(token), expected, || {
            blank::check_directory_identity(&self.root, &self.directory)
        })
    }
}

#[cfg(test)]
fn github_directory_key(root: &Path) -> Result<String, CreationError> {
    let directory = open_directory(root)?;
    blank::check_directory_identity(root, &directory)?;
    Ok(metadata_key(&directory.metadata().map_err(io_error)?))
}

fn metadata_key(metadata: &Metadata) -> String {
    let created = metadata
        .created()
        .ok()
        .and_then(|date| date.duration_since(UNIX_EPOCH).ok());
    format!(
        "{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        created.map_or(0, |date| date.as_secs()),
        created.map_or(0, |date| date.subsec_nanos())
    )
}

fn refuse(detail: &str) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}

fn conflict(detail: &str) -> CreationError {
    CreationError::new(CreationErrorCode::VersionConflict, detail)
}

fn parse_oid(value: &str) -> Result<Oid, CreationError> {
    if value.len() != 40 {
        return Err(conflict("The GitHub version changed. Refresh its status."));
    }
    Oid::from_str(value).map_err(|_| conflict("The GitHub version is invalid. Refresh its status."))
}

fn valid_github_name(repository: &str) -> bool {
    let Some((owner, name)) = repository.split_once('/') else {
        return false;
    };
    !owner.is_empty()
        && owner.len() <= 39
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !name.is_empty()
        && name.len() <= 100
        && !matches!(name, "." | "..")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn github_url(repository: &str) -> Result<String, CreationError> {
    if !valid_github_name(repository) {
        return Err(refuse("Choose a GitHub.com repository."));
    }
    Ok(format!("https://github.com/{repository}.git"))
}

fn github_origin(origin: &str) -> Option<String> {
    let repository = origin
        .strip_prefix("https://github.com/")
        .or_else(|| origin.strip_prefix("git@github.com:"))
        .or_else(|| origin.strip_prefix("ssh://git@github.com/"))?;
    let repository = repository.strip_suffix(".git").unwrap_or(repository);
    valid_github_name(repository).then(|| repository.to_owned())
}

fn branch_ref(branch: &str) -> Result<String, CreationError> {
    let name = format!("refs/heads/{branch}");
    if branch.is_empty() || branch.len() > 240 || !git2::Reference::is_valid_name(&name) {
        return Err(refuse("Choose a valid Git branch."));
    }
    Ok(name)
}

fn no_local_state() -> GithubLocalGit {
    GithubLocalGit {
        branch: None,
        head: None,
        origin: None,
    }
}

fn local_state(repo: &Repository) -> Result<GithubLocalGit, CreationError> {
    let raw_head = repo.find_reference("HEAD").map_err(local_git::git_error)?;
    let branch = raw_head
        .symbolic_target()
        .map_err(local_git::git_error)?
        .and_then(|name| name.strip_prefix("refs/heads/"))
        .map(str::to_owned);
    let head = match repo.head() {
        Ok(head) => Some(
            head.peel_to_commit()
                .map_err(local_git::git_error)?
                .id()
                .to_string(),
        ),
        Err(error) if error.code() == ErrorCode::UnbornBranch => None,
        Err(error) => return Err(local_git::git_error(error)),
    };
    let origin = repo
        .config()
        .map_err(local_git::git_error)?
        .get_string("remote.origin.url")
        .ok()
        .as_deref()
        .and_then(github_origin);
    Ok(GithubLocalGit {
        branch,
        head,
        origin,
    })
}

fn initialize(path: &Path, branch: &str, bare: bool) -> Result<Repository, CreationError> {
    let mut options = RepositoryInitOptions::new();
    options
        .bare(bare)
        .external_template(false)
        .initial_head(branch);
    Repository::init_opts(path, &options).map_err(local_git::git_error)
}

fn seed_history_probe(local: &Repository, scratch: &Repository) -> Result<(), CreationError> {
    let objects = local.path().join("objects");
    let objects = objects
        .to_str()
        .ok_or_else(|| refuse("The local Git directory is not UTF-8."))?;
    let odb = scratch.odb().map_err(local_git::git_error)?;
    odb.add_disk_alternate(objects)
        .map_err(local_git::git_error)?;
    scratch.set_odb(&odb).map_err(local_git::git_error)?;
    for (index, branch) in local
        .branches(Some(git2::BranchType::Local))
        .map_err(local_git::git_error)?
        .enumerate()
    {
        if index >= MAX_BIND_BRANCHES {
            return Err(refuse(
                "There are too many local branches to verify shared history in PNDS.",
            ));
        }
        let (branch, _) = branch.map_err(local_git::git_error)?;
        let reference = branch.get();
        if let Some(oid) = reference.target() {
            scratch
                .reference(
                    reference.name().map_err(local_git::git_error)?,
                    oid,
                    false,
                    "Read local project history",
                )
                .map_err(local_git::git_error)?;
        }
    }
    Ok(())
}

/// Replaces only the current Repository handle's config. This prevents
/// local/global URL rewrites, extra headers and proxies from seeing tokens.
fn transport_config(repo: &Repository) -> Result<tempfile::NamedTempFile, CreationError> {
    let config_file = tempfile::NamedTempFile::new().map_err(io_error)?;
    let mut config = Config::open(config_file.path()).map_err(local_git::git_error)?;
    config
        .set_bool("http.followRedirects", false)
        .map_err(local_git::git_error)?;
    config
        .set_bool("core.protectHFS", true)
        .map_err(local_git::git_error)?;
    config
        .set_bool("core.protectNTFS", true)
        .map_err(local_git::git_error)?;
    repo.set_config(&config).map_err(local_git::git_error)?;
    Ok(config_file)
}

fn callbacks(token: Option<&str>) -> RemoteCallbacks<'_> {
    let mut callbacks = RemoteCallbacks::new();
    let mut attempted = false;
    callbacks.credentials(move |url, _, allowed| {
        if let Some(token) = token.filter(|_| {
            !attempted
                && url.starts_with("https://github.com/")
                && allowed.contains(CredentialType::USER_PASS_PLAINTEXT)
        }) {
            attempted = true;
            Cred::userpass_plaintext("x-access-token", token)
        } else {
            Err(git2::Error::new(
                ErrorCode::Auth,
                ErrorClass::Http,
                "GitHub authentication refused",
            ))
        }
    });
    callbacks
}

fn transport_error(error: git2::Error) -> CreationError {
    // Avoid returning server-supplied text through the UI or logs.
    let message = error.message();
    let status = message
        .strip_prefix("unexpected http status code: ")
        .or_else(|| message.strip_prefix("unexpected HTTP status code: "))
        .and_then(|code| code.trim().parse::<u16>().ok());
    if error.code() == ErrorCode::Auth || matches!(status, Some(401 | 403 | 404)) {
        return CreationError::new(
            CreationErrorCode::Permission,
            "GitHub refused repository access. Check the account and repository authorization.",
        );
    }
    if error.code() == ErrorCode::Certificate {
        return CreationError::new(
            CreationErrorCode::Permission,
            "GitHub's HTTPS certificate could not be verified.",
        );
    }
    if error.code() == ErrorCode::Timeout
        || matches!(error.class(), ErrorClass::Net | ErrorClass::Ssl)
        || (error.class() == ErrorClass::Os && message.starts_with("failed to connect to "))
        || matches!(status, Some(408 | 429 | 500..=599))
    {
        return CreationError::new(
            CreationErrorCode::GitHubNetwork,
            "GitHub could not be reached. Check the network and retry.",
        );
    }
    if error.code() == ErrorCode::NotFastForward {
        return conflict("The remote branch changed. Refresh GitHub status before retrying.");
    }
    CreationError::new(CreationErrorCode::Io, "The GitHub transfer did not finish.")
}

struct AdvertisedRefs {
    branches: BTreeMap<String, Oid>,
    empty: bool,
}

fn advertised_refs(remote: &git2::Remote<'_>) -> Result<AdvertisedRefs, CreationError> {
    let mut branches = BTreeMap::new();
    let mut empty = true;
    for reference in remote.list().map_err(transport_error)? {
        let name = reference.name();
        if name.starts_with("refs/") && !reference.oid().is_zero() {
            empty = false;
        }
        if let Some(branch) = name.strip_prefix("refs/heads/") {
            if !reference.oid().is_zero() && branch_ref(branch).is_ok() {
                branches.insert(branch.to_owned(), reference.oid());
            }
        }
    }
    Ok(AdvertisedRefs { branches, empty })
}

fn list_remote(
    remote: &mut git2::Remote<'_>,
    token: Option<&str>,
) -> Result<AdvertisedRefs, CreationError> {
    let mut connection = remote
        .connect_auth(
            Direction::Fetch,
            Some(callbacks(token)),
            Some(ProxyOptions::new()),
        )
        .map_err(transport_error)?;
    advertised_refs(connection.remote())
}

fn download_branches(
    repo: &Repository,
    remote: &mut git2::Remote<'_>,
    token: Option<&str>,
    branches: &BTreeMap<String, Oid>,
) -> Result<(), CreationError> {
    let needed = branches
        .iter()
        .filter(|(_, id)| repo.find_commit(**id).is_err())
        .map(|(branch, _)| branch_ref(branch))
        .collect::<Result<Vec<_>, _>>()?;
    if needed.is_empty() {
        return Ok(());
    }
    let exceeded = Cell::new(false);
    let deadline = Instant::now() + TRANSFER_DEADLINE;
    let mut callbacks = callbacks(token);
    callbacks.transfer_progress(|progress| {
        let too_large = progress.received_bytes() > MAX_TRANSFER_BYTES
            || progress.total_objects() > MAX_TRANSFER_OBJECTS;
        exceeded.set(too_large);
        !too_large && Instant::now() < deadline
    });
    let mut options = FetchOptions::new();
    options
        .remote_callbacks(callbacks)
        .proxy_options(ProxyOptions::new())
        .follow_redirects(RemoteRedirect::None)
        .download_tags(AutotagOption::None)
        .update_fetchhead(false);
    let result = remote.download(&needed, Some(&mut options));
    let _ = remote.disconnect();
    if exceeded.get() {
        return Err(CreationError::new(
            CreationErrorCode::TooLarge,
            "The GitHub transfer exceeds the supported size.",
        ));
    }
    if result.is_err() && Instant::now() >= deadline {
        return Err(CreationError::new(
            CreationErrorCode::GitHubNetwork,
            "The GitHub transfer timed out.",
        ));
    }
    result.map_err(transport_error)?;
    let actual = advertised_refs(remote)?;
    for (branch, id) in branches {
        if actual.branches.get(branch) != Some(id) || repo.find_commit(*id).is_err() {
            return Err(conflict(
                "The remote branch changed while checking GitHub. Refresh its status.",
            ));
        }
    }
    Ok(())
}

fn probe_repository(
    repo: &Repository,
    local: GithubLocalGit,
    url: &str,
    token: Option<&str>,
    check_shared: bool,
) -> Result<GithubGitProbe, CreationError> {
    let _config = transport_config(repo)?;
    let mut remote = repo.remote_anonymous(url).map_err(transport_error)?;
    let advertised = list_remote(&mut remote, token)?;
    let remote_head = local
        .branch
        .as_ref()
        .and_then(|name| advertised.branches.get(name))
        .copied();
    let local_head = local.head.as_deref().map(parse_oid).transpose()?;
    let mut result = GithubGitProbe {
        local,
        remote_head: remote_head.map(|id| id.to_string()),
        remote_empty: advertised.empty,
        shared_history: false,
        relation: GithubGitRelation::NoLocalBranch,
        ahead: 0,
        behind: 0,
    };
    if let (Some(name), Some(local_id)) = (result.local.branch.as_ref(), local_head) {
        if let Some(remote_id) = remote_head {
            download_branches(
                repo,
                &mut remote,
                token,
                &BTreeMap::from([(name.clone(), remote_id)]),
            )?;
            let (ahead, behind) = repo
                .graph_ahead_behind(local_id, remote_id)
                .map_err(local_git::git_error)?;
            result.ahead = u32::try_from(ahead).unwrap_or(u32::MAX);
            result.behind = u32::try_from(behind).unwrap_or(u32::MAX);
            result.relation = match (ahead, behind) {
                (0, 0) => GithubGitRelation::Equal,
                (_, 0) => GithubGitRelation::Ahead,
                (0, _) => GithubGitRelation::Behind,
                _ => GithubGitRelation::Diverged,
            };
            result.shared_history = shared_history(repo, [local_id], [remote_id])?;
        } else {
            result.relation = GithubGitRelation::NewBranch;
        }
    }
    if check_shared && !result.shared_history && !advertised.empty {
        let mut tips = local_head.into_iter().collect::<Vec<_>>();
        for branch in repo
            .branches(Some(git2::BranchType::Local))
            .map_err(local_git::git_error)?
        {
            let (branch, _) = branch.map_err(local_git::git_error)?;
            if let Some(tip) = branch.get().target() {
                tips.push(tip);
            }
            if tips.len() > MAX_BIND_BRANCHES {
                return Err(refuse(
                    "There are too many local branches to verify shared history in PNDS.",
                ));
            }
        }
        if !tips.is_empty() {
            if advertised.branches.len() > MAX_BIND_BRANCHES {
                return Err(refuse(
                    "There are too many remote branches to verify shared history in PNDS.",
                ));
            }
            download_branches(repo, &mut remote, token, &advertised.branches)?;
            tips.sort_unstable();
            tips.dedup();
            result.shared_history =
                shared_history(repo, tips, advertised.branches.values().copied())?;
        }
    }
    Ok(result)
}

fn shared_history(
    repo: &Repository,
    local: impl IntoIterator<Item = Oid>,
    remote: impl IntoIterator<Item = Oid>,
) -> Result<bool, CreationError> {
    let local: Vec<_> = local.into_iter().collect();
    let remote: Vec<_> = remote.into_iter().collect();
    if let ([local], [remote]) = (local.as_slice(), remote.as_slice()) {
        return match repo.merge_base(*local, *remote) {
            Ok(_) => Ok(true),
            Err(error) if error.code() == ErrorCode::NotFound => Ok(false),
            Err(error) => Err(local_git::git_error(error)),
        };
    }
    let mut local_walk = repo.revwalk().map_err(local_git::git_error)?;
    for tip in local {
        local_walk.push(tip).map_err(local_git::git_error)?;
    }
    let mut history = std::collections::HashSet::new();
    for commit in local_walk {
        if history.len() >= MAX_TRANSFER_OBJECTS {
            return Err(refuse("The local history is too large to verify in PNDS."));
        }
        history.insert(commit.map_err(local_git::git_error)?);
    }
    let mut remote_walk = repo.revwalk().map_err(local_git::git_error)?;
    for tip in remote {
        remote_walk.push(tip).map_err(local_git::git_error)?;
    }
    for (index, commit) in remote_walk.enumerate() {
        if index >= MAX_TRANSFER_OBJECTS {
            return Err(refuse("The remote history is too large to verify in PNDS."));
        }
        if history.contains(&commit.map_err(local_git::git_error)?) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn push_repository(
    repo: &Repository,
    url: &str,
    token: Option<&str>,
    expected: &GithubGitProbe,
    verify_owner: impl Fn() -> Result<(), CreationError>,
) -> Result<(), CreationError> {
    if !matches!(
        expected.relation,
        GithubGitRelation::Ahead | GithubGitRelation::NewBranch
    ) {
        return Err(conflict(
            "The current branch cannot be backed up. Refresh GitHub status.",
        ));
    }
    let branch = expected
        .local
        .branch
        .as_deref()
        .ok_or_else(|| refuse("Switch to a local branch before backing up."))?;
    let target = branch_ref(branch)?;
    let head = parse_oid(
        expected
            .local
            .head
            .as_deref()
            .ok_or_else(|| refuse("Save a local version before backing up."))?,
    )?;
    let previous = expected.remote_head.as_deref().map(parse_oid).transpose()?;
    let check_head = || -> Result<(), CreationError> {
        verify_owner()?;
        let active = repo.head().map_err(local_git::git_error)?;
        if active.name().ok() != Some(target.as_str())
            || active.target().is_none_or(|oid| {
                oid != head && !repo.graph_descendant_of(oid, head).unwrap_or(false)
            })
        {
            return Err(conflict(
                "The current branch changed. Refresh GitHub status before backing up.",
            ));
        }
        Ok(())
    };
    check_head()?;
    let _config = transport_config(repo)?;
    let mut remote = repo.remote_anonymous(url).map_err(transport_error)?;
    let stale = Cell::new(false);
    let refused = Cell::new(false);
    let acknowledged = Cell::new(false);
    let deadline = Instant::now() + TRANSFER_DEADLINE;
    let mut callbacks = callbacks(token);
    callbacks.sideband_progress(|_| Instant::now() < deadline);
    callbacks.push_negotiation(|updates| {
        if updates.len() != 1
            || updates[0].dst_refname().ok() != Some(target.as_str())
            || updates[0].dst() != head
            || updates[0].src() != previous.unwrap_or(Oid::ZERO_SHA1)
            || check_head().is_err()
        {
            stale.set(true);
            return Err(git2::Error::from_str("GitHub branch changed"));
        }
        Ok(())
    });
    callbacks.push_update_reference(|name, status| {
        if name == target && status.is_none() {
            acknowledged.set(true);
        } else {
            refused.set(true);
        }
        Ok(())
    });
    let mut options = PushOptions::new();
    options
        .remote_callbacks(callbacks)
        .proxy_options(ProxyOptions::new())
        .follow_redirects(RemoteRedirect::None);
    let refspec = format!("{head}:{target}");
    let result = remote.push(&[refspec.as_str()], Some(&mut options));
    if stale.get() {
        return Err(conflict(
            "The branch changed before GitHub accepted the backup. Refresh its status.",
        ));
    }
    if refused.get() {
        return Err(CreationError::new(
            CreationErrorCode::Permission,
            "GitHub rejected the backup. Check branch protection and repository write permission.",
        ));
    }
    if result.is_err() && Instant::now() >= deadline {
        return Err(CreationError::new(
            CreationErrorCode::GitHubNetwork,
            "The GitHub transfer timed out.",
        ));
    }
    result.map_err(transport_error)?;
    if !acknowledged.get() {
        return Err(conflict(
            "GitHub did not confirm the branch update. Refresh its status.",
        ));
    }
    Ok(())
}

fn open_directory(path: &Path) -> Result<File, CreationError> {
    File::options()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(io_error)
}

fn valid_folder(folder: &str) -> bool {
    !folder.trim().is_empty()
        && folder.len() <= 120
        && !folder.starts_with('.')
        && !folder.contains(['/', '\\'])
        && !folder.chars().any(char::is_control)
}

fn require_absent(target: &Path) -> Result<(), CreationError> {
    match fs::symlink_metadata(target) {
        Ok(_) => Err(CreationError::new(
            CreationErrorCode::TargetExists,
            target.to_string_lossy(),
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

pub(crate) fn clone_github_project(
    repository: &str,
    branch: &str,
    token: Option<&str>,
    parent: &Path,
    folder: &str,
    protection: &Protection,
) -> Result<(PathBuf, String), CreationError> {
    let url = github_url(repository)?;
    clone_project(&url, branch, token, parent, folder, protection)
}

fn clone_project(
    url: &str,
    branch: &str,
    token: Option<&str>,
    parent: &Path,
    folder: &str,
    protection: &Protection,
) -> Result<(PathBuf, String), CreationError> {
    let reference = branch_ref(branch)?;
    if !valid_folder(folder) {
        return Err(refuse("Enter a single name for the new project folder."));
    }
    let parent = fs::canonicalize(parent).map_err(io_error)?;
    local_git::require_no_parent_repository(&parent)?;
    let held_parent = open_directory(&parent)?;
    let target = parent.join(folder);
    if matches!(
        protection.source(&target),
        CreationSource::Bundle | CreationSource::Utility
    ) {
        return Err(CreationError::new(
            CreationErrorCode::Permission,
            "Choose a project location outside installed bundles and utilities.",
        ));
    }
    require_absent(&target)?;
    let staging = tempfile::Builder::new()
        .prefix(".pnds-clone-")
        .tempdir_in(&parent)
        .map_err(io_error)?;
    blank::check_directory_identity(&parent, &held_parent)?;
    let held_staging = open_directory(staging.path())?;
    let repo = initialize(staging.path(), branch, false)?;
    let _config = transport_config(&repo)?;
    let mut remote = repo.remote_anonymous(url).map_err(transport_error)?;
    let advertised = list_remote(&mut remote, token)?;
    let id = *advertised
        .branches
        .get(branch)
        .ok_or_else(|| conflict("This GitHub branch no longer exists."))?;
    download_branches(
        &repo,
        &mut remote,
        token,
        &BTreeMap::from([(branch.to_owned(), id)]),
    )?;
    drop(remote);
    blank::check_directory_identity(&parent, &held_parent)?;
    blank::check_directory_identity(staging.path(), &held_staging)?;
    let tree = git_restore::target_for_sync(&repo, id)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout
        .safe()
        .recreate_missing(true)
        .disable_filters(true)
        .overwrite_ignored(false);
    repo.checkout_tree(tree.as_object(), Some(&mut checkout))
        .map_err(local_git::git_error)?;
    repo.reference(&reference, id, false, "Clone project from GitHub")
        .map_err(local_git::git_error)?;
    CreationAccess::default().prepare(staging.path(), protection)?;
    blank::initialize_empty_chat(&held_staging, &target)?;
    blank::check_directory_identity(&parent, &held_parent)?;
    blank::check_directory_identity(staging.path(), &held_staging)?;
    local_git::require_no_parent_repository(&parent)?;
    let directory_key = metadata_key(&held_staging.metadata().map_err(io_error)?);
    blank::publish_staged_directory(&held_parent, staging, &target)?;
    Ok((target, directory_key))
}

#[cfg(test)]
mod tests;
