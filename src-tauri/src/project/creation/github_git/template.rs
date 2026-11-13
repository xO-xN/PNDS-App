use super::*;
use crate::github_auth::{GithubRepository, OFFICIAL_TEMPLATE_REPOSITORY};
use git2::{ObjectType, Remote};

const MARKER: &str = "docs/template-source.json";
const MAX_METADATA_BYTES: usize = 16 * 1024;
const APP_BLANK_SOURCE: &str = "PNDS App embedded blank-project";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum GithubTemplateVerification {
    Ready {
        #[serde(rename = "remoteHead")]
        remote_head: String,
        #[serde(rename = "templateVersion")]
        template_version: String,
    },
    BranchMismatch,
    NotOfficialTemplate,
    LegacyTemplate,
    SnapshotMismatch,
    RemoteHistoryChanged,
}

#[derive(serde::Deserialize)]
struct TemplateSource {
    template: String,
    version: String,
    source: Option<String>,
}

enum CommittedJson<T> {
    Missing,
    Invalid,
    Parsed(T),
}

impl GithubGitContext {
    pub(crate) fn can_upload_initial_version(
        &self,
        expected_head: &str,
    ) -> Result<bool, CreationError> {
        let Some(repo) = self.repository()? else {
            return Ok(false);
        };
        let commit =
            native_git::GitReadBudget::default().commit(&repo, parse_oid(expected_head)?)?;
        if commit.parent_count() != 0 {
            return Ok(false);
        }
        self.can_verify_template(expected_head)
    }

    pub(crate) fn can_verify_template(&self, expected_head: &str) -> Result<bool, CreationError> {
        let Some(repo) = self.repository()? else {
            return Ok(false);
        };
        let mut id = parse_oid(expected_head)?;
        let mut budget = native_git::GitReadBudget::default();
        // The generation marker belongs to the initial version. Authors can
        // change or remove it from the contents of later versions.
        loop {
            let commit = match budget.commit(&repo, id) {
                Ok(commit) => commit,
                Err(error) if error.code == CreationErrorCode::TooLarge => return Ok(false),
                Err(error) => return Err(error),
            };
            if commit.parent_count() == 0 {
                match budget.tree(&repo, commit.tree_id()) {
                    Ok(()) => (),
                    Err(error) if error.code == CreationErrorCode::TooLarge => return Ok(false),
                    Err(error) => return Err(error),
                }
                let tree = commit.tree().map_err(local_git::git_error)?;
                let CommittedJson::Parsed(source) =
                    committed_json::<TemplateSource>(&repo, &tree, MARKER)?
                else {
                    return Ok(false);
                };
                return Ok(source.template == "Blank"
                    && source.source.as_deref() == Some(APP_BLANK_SOURCE));
            }
            id = commit.parent_id(0).map_err(local_git::git_error)?;
        }
    }

    pub(crate) fn verify_template(
        &self,
        repository: &GithubRepository,
        token: &str,
        local_branch: Option<&str>,
    ) -> Result<GithubTemplateVerification, CreationError> {
        let verification = verify_template_repository(
            local_branch,
            &repository.default_branch,
            (&github_url(&repository.full_name)?, Some(token)),
            &github_url(OFFICIAL_TEMPLATE_REPOSITORY)?,
        )?;
        blank::check_directory_identity(&self.root, &self.directory)?;
        Ok(verification)
    }
}

fn committed_json<T: serde::de::DeserializeOwned>(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    path: &str,
) -> Result<CommittedJson<T>, CreationError> {
    let entry = match tree.get_path(Path::new(path)) {
        Ok(entry) if entry.filemode() == 0o100644 => entry,
        Ok(_) => return Ok(CommittedJson::Invalid),
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(CommittedJson::Missing),
        Err(error) => return Err(local_git::git_error(error)),
    };
    let odb = repo.odb().map_err(local_git::git_error)?;
    let (size, kind) = odb.read_header(entry.id()).map_err(local_git::git_error)?;
    if size > MAX_METADATA_BYTES || kind != ObjectType::Blob {
        return Ok(CommittedJson::Invalid);
    }
    let marker = odb.read(entry.id()).map_err(local_git::git_error)?;
    Ok(match serde_json::from_slice(marker.data()) {
        Ok(source) => CommittedJson::Parsed(source),
        Err(_) => CommittedJson::Invalid,
    })
}

fn version_tag(version: &str) -> Option<String> {
    let core = version.split(['-', '+']).next()?;
    let number = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    let tag = format!("refs/tags/pnds-blank-v{version}");
    (version.len() <= 80
        && core.split('.').count() == 3
        && core.split('.').all(number)
        && version
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'-' | b'+'))
        && git2::Reference::is_valid_name(&tag))
    .then_some(tag)
}

fn advertised_oid(remote: &Remote<'_>, name: &str) -> Result<Option<Oid>, CreationError> {
    Ok(remote
        .list()
        .map_err(transport_error)?
        .iter()
        .find(|entry| entry.name() == name && !entry.oid().is_zero())
        .map(git2::RemoteHead::oid))
}

pub(super) fn advertised_default(
    remote: &Remote<'_>,
    name: &str,
) -> Result<Option<Oid>, CreationError> {
    let branch = advertised_oid(remote, name)?;
    let head = remote
        .list()
        .map_err(transport_error)?
        .iter()
        .find(|entry| entry.name() == "HEAD" && entry.symref_target() == Some(name))
        .map(git2::RemoteHead::oid);
    Ok(branch.filter(|oid| Some(*oid) == head))
}

fn verify_template_repository(
    local_branch: Option<&str>,
    default_branch: &str,
    target: (&str, Option<&str>),
    official_url: &str,
) -> Result<GithubTemplateVerification, CreationError> {
    use GithubTemplateVerification::*;
    if local_branch != Some(default_branch) {
        return Ok(BranchMismatch);
    }
    let default_ref = branch_ref(default_branch)?;
    let scratch = tempfile::tempdir().map_err(io_error)?;
    let repo = initialize(scratch.path(), "main", true)?;
    let _config = transport_config(&repo)?;
    let (target_url, token) = target;
    let mut target = repo.remote_anonymous(target_url).map_err(transport_error)?;
    let mut target_conn = target
        .connect_auth(
            Direction::Fetch,
            Some(callbacks(token)),
            Some(ProxyOptions::new()),
        )
        .map_err(transport_error)?;
    let Some(root) = advertised_default(target_conn.remote(), &default_ref)? else {
        return Ok(RemoteHistoryChanged);
    };
    download_refs(
        target_conn.remote(),
        token,
        std::slice::from_ref(&default_ref),
    )?;
    drop(target_conn);
    let mut budget = native_git::GitReadBudget::default();
    let commit = budget.commit(&repo, root)?;
    if commit.parent_count() != 0 {
        return Ok(RemoteHistoryChanged);
    }
    budget.tree(&repo, commit.tree_id())?;
    let tree = commit.tree().map_err(local_git::git_error)?;
    let marker = match committed_json::<TemplateSource>(&repo, &tree, MARKER)? {
        CommittedJson::Missing => return Ok(LegacyTemplate),
        CommittedJson::Invalid => return Ok(SnapshotMismatch),
        CommittedJson::Parsed(marker) if marker.template == "Blank" => marker,
        CommittedJson::Parsed(_) => return Ok(SnapshotMismatch),
    };
    let Some(tag_ref) = version_tag(&marker.version) else {
        return Ok(SnapshotMismatch);
    };
    let mut official = repo
        .remote_anonymous(official_url)
        .map_err(transport_error)?;
    let mut official_conn = official
        .connect_auth(Direction::Fetch, None, Some(ProxyOptions::new()))
        .map_err(transport_error)?;
    let Some(tag) = advertised_oid(official_conn.remote(), &tag_ref)? else {
        return Ok(SnapshotMismatch);
    };
    download_refs(official_conn.remote(), None, &[tag_ref])?;
    let snapshot = repo
        .find_object(tag, None)
        .and_then(|object| object.peel_to_commit());
    if !snapshot.is_ok_and(|snapshot| snapshot.tree_id() == commit.tree_id()) {
        return Ok(SnapshotMismatch);
    }
    let mut current_target = target
        .connect_auth(
            Direction::Fetch,
            Some(callbacks(token)),
            Some(ProxyOptions::new()),
        )
        .map_err(transport_error)?;
    if advertised_default(current_target.remote(), &default_ref)? != Some(root) {
        return Ok(RemoteHistoryChanged);
    }
    Ok(Ready {
        remote_head: root.to_string(),
        template_version: marker.version,
    })
}

#[cfg(test)]
#[path = "template_tests.rs"]
mod tests;
