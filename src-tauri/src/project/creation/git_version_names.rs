//! Local display metadata lives in repository-local config; commits stay immutable.
use super::*;
use git2::{Commit, Repository};

const DEFAULT_VERSION_NAME: &str = "Project version";

#[derive(Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VersionName {
    pub(super) name: String,
    base: String,
    sequence: u32,
}
fn invalid(detail: impl Into<String>) -> CreationError {
    CreationError::new(CreationErrorCode::TestValidation, detail)
}
fn validate(name: &str) -> Result<(), CreationError> {
    if name.is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err(invalid(
            "Enter a version display name of 1–120 characters without control characters.",
        ));
    }
    Ok(())
}
fn config(repo: &Repository) -> Result<git2::Config, CreationError> {
    let metadata = match fs::symlink_metadata(repo.path().join("config")) {
        Ok(metadata) => metadata,
        // Linked-worktree inspection may use an empty isolated config. It
        // remains read-only; the independent repository boundary owns writes.
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return repo.config().map_err(local_git::git_error)
        }
        Err(error) => return Err(io_error(error)),
    };
    if !metadata.is_file() || metadata.is_symlink() || metadata.len() > TEXT_MAX_BYTES {
        return Err(invalid(
            "Version names require a regular repository-local config of at most 1 MiB.",
        ));
    }
    repo.config().map_err(local_git::git_error)
}
fn key(commit: &Commit<'_>) -> String {
    format!("pndsVersion.{}.display", commit.id())
}
fn stored(repo: &Repository, commit: &Commit<'_>) -> Result<Option<VersionName>, CreationError> {
    let config = config(repo)?;
    match config.get_string(&key(commit)) {
        Ok(value) => {
            if value.len() > 4096 {
                return Err(invalid("Version name metadata is too large."));
            }
            let entry: VersionName = serde_json::from_str(&value)
                .map_err(|_| invalid("Version name metadata is invalid."))?;
            validate(&entry.name)?;
            validate(&entry.base)?;
            Ok(Some(entry))
        }
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(error) => Err(local_git::git_error(error)),
    }
}
pub(super) fn stored_names(
    repo: &Repository,
) -> Result<std::collections::BTreeSet<String>, CreationError> {
    let config = config(repo)?;
    let mut names = std::collections::BTreeSet::new();
    let mut entries = config
        .entries(Some("^pndsversion\\..*\\.display$"))
        .map_err(local_git::git_error)?;
    while let Some(entry) = entries.next() {
        let entry = entry.map_err(local_git::git_error)?;
        let value = entry.value().map_err(local_git::git_error)?;
        if value.len() > 4096 {
            return Err(invalid("Version name metadata is too large."));
        }
        let name: VersionName = serde_json::from_str(value)
            .map_err(|_| invalid("Version name metadata is invalid."))?;
        validate(&name.name)?;
        validate(&name.base)?;
        names.insert(name.name);
    }
    Ok(names)
}
pub(super) fn display(repo: &Repository, commit: &Commit<'_>) -> Result<String, CreationError> {
    Ok(stored(repo, commit)?
        .map(|entry| entry.name)
        .unwrap_or(commit.message().map_err(local_git::git_error)?.to_owned()))
}
fn lineage(repo: &Repository, commit: &Commit<'_>) -> Result<VersionName, CreationError> {
    if let Some(entry) = stored(repo, commit)? {
        return Ok(entry);
    }
    let name = commit
        .summary()
        .map_err(local_git::git_error)?
        .unwrap_or(DEFAULT_VERSION_NAME)
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let name = if name.is_empty() {
        DEFAULT_VERSION_NAME.to_owned()
    } else {
        name
    };
    let (base, sequence) = name
        .rsplit_once(' ')
        .and_then(|(base, suffix)| {
            suffix
                .parse::<u32>()
                .ok()
                .filter(|number| *number > 0 && !base.is_empty())
                .map(|number| (base.to_owned(), number))
        })
        .unwrap_or((name.clone(), 0));
    Ok(VersionName {
        name,
        base,
        sequence,
    })
}
pub(super) fn next(repo: &Repository) -> Result<Option<VersionName>, CreationError> {
    let head = match repo.head() {
        Ok(head) => head.peel_to_commit().map_err(local_git::git_error)?,
        Err(error)
            if matches!(
                error.code(),
                git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
            ) =>
        {
            return Ok(None)
        }
        Err(error) => return Err(local_git::git_error(error)),
    };
    let parent = lineage(repo, &head)?;
    let names = super::git_versions::display_names(repo)?;
    let mut sequence = parent.sequence;
    loop {
        sequence = sequence
            .checked_add(1)
            .ok_or_else(|| invalid("Version sequence is exhausted."))?;
        let suffix = format!(" {sequence}");
        let base = parent
            .base
            .chars()
            .take(120 - suffix.len())
            .collect::<String>();
        let name = format!("{base}{suffix}");
        if !names.contains(&name) {
            validate(&name)?;
            return Ok(Some(VersionName {
                name,
                base: parent.base,
                sequence,
            }));
        }
    }
}
pub(super) fn next_name(repo: &Repository) -> Result<Option<String>, CreationError> {
    Ok(next(repo)?.map(|entry| entry.name))
}
pub(super) fn for_save(repo: &Repository, name: &str) -> Result<VersionName, CreationError> {
    if let Some(next) = next(repo)?.filter(|entry| name.is_empty() || entry.name == name) {
        return Ok(next);
    }
    let name = if name.is_empty() {
        DEFAULT_VERSION_NAME
    } else {
        name
    };
    // Existing legacy recording accepts multi-line messages. Its display name
    // uses the first line; the original full message remains in the commit.
    let name = name
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(120)
        .collect::<String>();
    validate(&name)?;
    Ok(VersionName {
        name: name.clone(),
        base: name,
        sequence: 0,
    })
}
pub(super) fn persist(
    repo: &Repository,
    commit: &Commit<'_>,
    name: &VersionName,
) -> Result<(), CreationError> {
    let value = serde_json::to_string(name)
        .map_err(|error| invalid(format!("Cannot encode version name: {error}")))?;
    if fs::metadata(repo.path().join("config"))
        .map_err(io_error)?
        .len()
        + value.len() as u64 * 2
        + 128
        > TEXT_MAX_BYTES
    {
        return Err(invalid("Repository-local version metadata exceeds 1 MiB."));
    }
    config(repo)?
        .set_str(&key(commit), &value)
        .map_err(local_git::git_error)
}
impl CreationAccess {
    pub fn rename_git_version(
        &mut self,
        identity: &str,
        commit: &str,
        expected_name: &str,
        name: &str,
        protection: &Protection,
    ) -> Result<String, CreationError> {
        validate(name.trim())?;
        let project = self.current(identity, protection)?;
        ensure_editable(project)?;
        let repo = local_git::write_boundary(&project.root, false)?
            .ok_or_else(|| invalid("No local repository exists."))?;
        let commit = super::git_versions::reachable(&repo, commit)?;
        if display(&repo, &commit)? != expected_name {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "The version name changed. Refresh versions before renaming.",
            ));
        }
        let name = name.trim().to_owned();
        validate_identity(project, protection)?;
        persist(
            &repo,
            &commit,
            &VersionName {
                name: name.clone(),
                base: name.clone(),
                sequence: 0,
            },
        )?;
        Ok(name)
    }
}
