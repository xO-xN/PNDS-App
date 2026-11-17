use super::*;

fn state_fingerprint(
    project: &OpenProject,
    repo: &Repository,
    entries: &Entries,
) -> Result<String, CreationError> {
    let mut digest = Sha256::new();
    let head = repo.head().map_err(git)?;
    digest.update(format!("{:?}:{:?}", head.name().ok(), head.target()));
    for name in [
        "HEAD",
        "index",
        "config",
        "info/attributes",
        "info/exclude",
        "shallow",
    ] {
        let path = repo.path().join(name);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.is_symlink() {
                    return Err(invalid("Git metadata must remain regular files"));
                }
                digest.update(name);
                digest.update(bounded_read(
                    File::options()
                        .read(true)
                        .custom_flags(libc::O_NOFOLLOW)
                        .open(path)
                        .map_err(io_error)?,
                    local_git::GIT_FILE_LIMIT,
                )?);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => digest.update(b"missing"),
            Err(error) => return Err(io_error(error)),
        }
    }
    for (path, entry) in entries {
        let file = project.file(path)?;
        let metadata = file.metadata().map_err(io_error)?;
        if !metadata.is_file() {
            return Err(conflict("Saved project paths changed"));
        }
        digest.update(path);
        digest.update(format!("{}", metadata.mode() & 0o111));
        digest.update(bounded_read(file, local_git::GIT_FILE_LIMIT)?);
        digest.update(entry.mode.to_le_bytes());
    }
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .update_index(false);
    for item in repo.statuses(Some(&mut options)).map_err(git)?.iter() {
        if let Ok(path) = item.path() {
            if crate::creation_data::contains(Path::new(path))
                || (item.status().is_wt_new() && local_git::excluded(path, 0).is_some())
            {
                continue;
            }
            digest.update(path);
            digest.update(item.status().bits().to_le_bytes());
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn require_clean(project: &OpenProject, repo: &Repository) -> Result<(), CreationError> {
    git_restore::require_unstaged(repo)?;
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .update_index(false);
    for item in repo.statuses(Some(&mut options)).map_err(git)?.iter() {
        let path = item.path().map_err(git)?;
        if crate::creation_data::contains(Path::new(path))
            || (item.status().is_wt_new() && local_git::excluded(path, 0).is_some())
        {
            continue;
        }
        return Err(invalid(
            "Save a project version or explicitly discard current changes before merging",
        ));
    }
    let _ = project;
    Ok(())
}
fn fixed_relation(project: &OpenProject, source: &str) -> Result<GitMergeProbe, CreationError> {
    let repo = native_git::repository(&project.root)?;
    let selected = git_versions::reachable(&repo, source)?;
    let target = repo
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(git)?;
    // Traverse and bound ancestry before handing graph queries to libgit2.
    let mut seen = BTreeSet::new();
    let mut pending = vec![selected.id(), target.id()];
    let mut budget = native_git::GitReadBudget::default();
    while let Some(id) = pending.pop() {
        if !seen.insert(id) {
            continue;
        }
        if seen.len() > 1200 {
            return Err(invalid(
                "Merge ancestry exceeds 1200 commits; use an external Git tool",
            ));
        }
        let commit = budget.commit(&repo, id)?;
        pending.extend(commit.parent_ids());
    }
    let relation = if selected.id() == target.id()
        || repo
            .graph_descendant_of(target.id(), selected.id())
            .map_err(git)?
    {
        GitMergeRelation::Included
    } else if repo
        .graph_descendant_of(selected.id(), target.id())
        .map_err(git)?
    {
        GitMergeRelation::FastForward
    } else {
        GitMergeRelation::Diverged
    };
    let base = if relation == GitMergeRelation::Diverged {
        let bases = repo
            .merge_bases(target.id(), selected.id())
            .map_err(|error| invalid(format!("No supported common merge base: {error}")))?;
        if bases.len() != 1 {
            return Err(invalid(
                "Multiple common bases require an external Git tool",
            ));
        }
        Some(bases[0].to_string())
    } else {
        Some(
            if relation == GitMergeRelation::Included {
                selected.id()
            } else {
                target.id()
            }
            .to_string(),
        )
    };
    let head = repo.head().map_err(git)?;
    let branch = if head.is_branch() {
        head.name().ok().map(str::to_owned)
    } else {
        None
    };
    Ok(GitMergeProbe {
        relation,
        source: selected.id().to_string(),
        target: target.id().to_string(),
        base,
        branch,
        dirty: relation != GitMergeRelation::Included && require_clean(project, &repo).is_err(),
    })
}
pub(super) fn copy_inputs(
    real: &Repository,
    private: &Repository,
    heads: &[Oid],
) -> Result<(), CreationError> {
    let mut commits = BTreeSet::new();
    let mut objects = BTreeSet::new();
    let mut pending = heads.to_vec();
    let mut total = 0usize;
    fn copy(
        repo: &Repository,
        to: &Repository,
        id: Oid,
        objects: &mut BTreeSet<Oid>,
        total: &mut usize,
    ) -> Result<(), CreationError> {
        if !objects.insert(id) {
            return Ok(());
        }
        let odb = repo.odb().map_err(git)?;
        let (size, kind) = odb.read_header(id).map_err(git)?;
        *total += size;
        if size as u64 > local_git::GIT_FILE_LIMIT
            || *total as u64 > local_git::GIT_TOTAL_LIMIT
            || objects.len() > 65_536
        {
            return Err(invalid("Fixed merge inputs exceed supported limits"));
        }
        let object = odb.read(id).map_err(git)?;
        let written = to
            .odb()
            .map_err(git)?
            .write(kind, object.data())
            .map_err(git)?;
        if written != id {
            return Err(conflict("A fixed merge Git object is corrupted"));
        }
        let oid = id.to_string();
        let path = to.path().join("objects").join(&oid[..2]).join(&oid[2..]);
        match File::options()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
        {
            Ok(file) => file.sync_all().map_err(io_error)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        };
        if kind == ObjectType::Tree {
            for item in repo.find_tree(id).map_err(git)?.iter() {
                copy(repo, to, item.id(), objects, total)?;
            }
        }
        Ok(())
    }
    while let Some(id) = pending.pop() {
        if !commits.insert(id) {
            continue;
        }
        if commits.len() > 1200 {
            return Err(invalid("Merge history exceeds 1200 commits"));
        }
        let commit = real.find_commit(id).map_err(git)?;
        inventory(real, commit.tree_id())?;
        copy(real, private, id, &mut objects, &mut total)?;
        copy(real, private, commit.tree_id(), &mut objects, &mut total)?;
        pending.extend(commit.parent_ids());
    }
    sync_private_repository(private)?;
    Ok(())
}
fn private_init(path: &Path) -> Result<Repository, CreationError> {
    let mut options = git2::RepositoryInitOptions::new();
    options.bare(true).external_template(false);
    let repo = Repository::init_opts(path, &options).map_err(git)?;
    repo.config()
        .map_err(git)?
        .set_bool("core.fsyncObjectFiles", true)
        .map_err(git)?;
    Ok(repo)
}
fn merged(private: &Repository, record: &mut Record) -> Result<(), CreationError> {
    if record.relation == GitMergeRelation::FastForward {
        record.entries = record.incoming.clone();
        return Ok(());
    }
    let base = private
        .find_commit(parse(
            record
                .base
                .as_deref()
                .ok_or_else(|| invalid("Missing common base"))?,
        )?)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let current = private
        .find_commit(parse(&record.target)?)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let incoming = private
        .find_commit(parse(&record.source)?)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let mut options = git2::MergeOptions::new();
    options.find_renames(true);
    let index = private
        .merge_trees(&base, &current, &incoming, Some(&options))
        .map_err(git)?;
    for entry in index.iter() {
        if entry.flags & 0x3000 != 0 {
            continue;
        }
        let path = std::str::from_utf8(&entry.path)
            .map_err(|_| invalid("Merge result path is not UTF-8"))?
            .to_owned();
        valid_path(&path)?;
        record.entries.insert(
            path,
            Entry {
                oid: entry.id.to_string(),
                mode: entry.mode,
            },
        );
    }
    for conflict in index.conflicts().map_err(git)? {
        let conflict = conflict.map_err(git)?;
        let paths = [
            conflict.ancestor.as_ref(),
            conflict.our.as_ref(),
            conflict.their.as_ref(),
        ]
        .into_iter()
        .flatten()
        .map(|entry| {
            String::from_utf8(entry.path.clone()).map_err(|_| invalid("Conflict path is not UTF-8"))
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
        if paths.len() != 1 {
            return Err(invalid(
                "Complex rename conflicts require an external Git tool",
            ));
        }
        let path = paths
            .into_iter()
            .next()
            .ok_or_else(|| invalid("Invalid conflict"))?;
        valid_path(&path)?;
        let current = record.current.get(&path);
        let incoming = record.incoming.get(&path);
        let ancestor = record.ancestor.get(&path);
        let current_bytes = current.map(|entry| blob(private, entry)).transpose()?;
        let incoming_bytes = incoming.map(|entry| blob(private, entry)).transpose()?;
        let ancestor_bytes = ancestor.map(|entry| blob(private, entry)).transpose()?;
        let text = current_bytes
            .as_ref()
            .zip(incoming_bytes.as_ref())
            .is_some_and(|(a, b)| {
                kind(&path, Some(a)) == GitMergeFileKind::Text
                    && kind(&path, Some(b)) == GitMergeFileKind::Text
            })
            && ancestor_bytes
                .as_ref()
                .is_none_or(|bytes| kind(&path, Some(bytes)) == GitMergeFileKind::Text);
        let (conflict_kind, markers) = if current.is_none() || incoming.is_none() {
            (GitMergeConflictKind::DeleteModify, None)
        } else if text {
            let marker = format!("PNDS-{}", record.id);
            let mut options = git2::MergeFileOptions::new();
            options
                .ancestor_label(format!("{marker}-base"))
                .our_label(format!("{marker}-current"))
                .their_label(format!("{marker}-incoming"));
            let mut base = git2::MergeFileInput::new();
            base.content(ancestor_bytes.as_deref().unwrap_or_default());
            let mut ours = git2::MergeFileInput::new();
            ours.content(current_bytes.as_deref().unwrap_or_default());
            let mut theirs = git2::MergeFileInput::new();
            theirs.content(incoming_bytes.as_deref().unwrap_or_default());
            let output =
                git2::merge_file(&base, &ours, &theirs, Some(&mut options)).map_err(git)?;
            let oid = private.blob(output.content()).map_err(git)?;
            record.entries.insert(
                path.clone(),
                Entry {
                    oid: oid.to_string(),
                    mode: current.map_or(0o100644, |entry| entry.mode),
                },
            );
            (GitMergeConflictKind::Text, Some(marker))
        } else {
            (GitMergeConflictKind::Binary, None)
        };
        if conflict_kind != GitMergeConflictKind::Text {
            if let Some(entry) = current.or(incoming) {
                record.entries.insert(path.clone(), entry.clone());
            }
        }
        record.conflicts.insert(
            path,
            Conflict {
                kind: conflict_kind,
                resolved: false,
                markers,
            },
        );
    }
    // Detect directory/file and case-folded result conflicts before presenting a candidate.
    let mut keys = BTreeSet::new();
    for path in record.entries.keys() {
        if !keys.insert(git_restore::checkout_name_key(path)) {
            return Err(invalid("Merged paths collide on this filesystem"));
        }
        for ancestor in Path::new(path).ancestors().skip(1) {
            if let Some(ancestor) = ancestor.to_str() {
                if record.entries.contains_key(ancestor) {
                    return Err(invalid(
                        "File/directory conflicts require an external Git tool",
                    ));
                }
            }
        }
    }
    Ok(())
}
pub(super) fn require_revision(record: &Record, revision: u32) -> Result<(), CreationError> {
    if record.revision != revision {
        return Err(conflict(
            "Merge result changed; reload the current candidate",
        ));
    }
    Ok(())
}
pub(super) fn require_active(record: &Record, owner: Option<&str>) -> Result<(), CreationError> {
    if record.phase != GitMergePhase::Active {
        return Err(invalid("Continue or reprepare this merge candidate first"));
    }
    if record.owner.as_deref() != owner {
        return Err(invalid(
            "The merge assistant owns this candidate; stop it before editing",
        ));
    }
    Ok(())
}
pub(super) fn fresh(project: &OpenProject, record: &Record) -> Result<(), CreationError> {
    let repo = repository(project)?;
    let fingerprint = state_fingerprint(project, &repo, &record.current)?;
    if fingerprint != record.baseline {
        return Err(conflict(
            "The actual project or target route changed. Reprepare the merge candidate.",
        ));
    }
    Ok(())
}
fn bump(record: &mut Record) -> Result<(), CreationError> {
    record.revision = record
        .revision
        .checked_add(1)
        .ok_or_else(|| invalid("Merge revision limit reached"))?;
    Ok(())
}
fn materialize(repo: &Repository, entries: &Entries, root: &Path) -> Result<(), CreationError> {
    for (path, entry) in entries {
        valid_path(path)?;
        let target = root.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut file = File::options()
            .write(true)
            .create_new(true)
            .mode(if entry.mode & 0o111 != 0 {
                0o700
            } else {
                0o600
            })
            .custom_flags(libc::O_NOFOLLOW)
            .open(target)
            .map_err(io_error)?;
        file.write_all(&blob(repo, entry)?).map_err(io_error)?;
    }
    Ok(())
}
pub(super) fn mandatory(repo: &Repository, record: &Record) -> Result<(), CreationError> {
    if record.conflicts.values().any(|conflict| !conflict.resolved) {
        return Err(invalid(
            "Resolve the remaining merge conflicts before testing or completing",
        ));
    }
    let entry = record
        .entries
        .get("manifest.json")
        .ok_or_else(|| invalid("The merge result must contain manifest.json"))?;
    let bytes = blob(repo, entry)?;
    if bytes.len() as u64 > TEXT_MAX_BYTES {
        return Err(invalid("Manifest exceeds the text limit"));
    }
    let text = std::str::from_utf8(&bytes).map_err(|error| invalid(error.to_string()))?;
    let manifest = crate::project::manifest::parse_manifest(text)
        .map_err(|detail| CreationError::new(CreationErrorCode::ManifestInvalid, detail))?;
    if !record.entries.contains_key(&manifest.score_server.entry) {
        return Err(invalid("The merge result is missing scoreServer.entry"));
    }
    let directory = manifest
        .score_server
        .working_directory
        .trim_end_matches('/');
    if directory != "."
        && !directory.is_empty()
        && !record
            .entries
            .keys()
            .any(|path| path.starts_with(&format!("{directory}/")))
    {
        return Err(invalid(
            "The merge result is missing scoreServer.workingDirectory",
        ));
    }
    validate_transition(&record.current, &record.entries)?;
    let _ = tree(repo, &record.entries)?;
    Ok(())
}

impl CreationAccess {
    pub fn probe_git_merge(
        &self,
        identity: &str,
        source: &str,
        protection: &Protection,
    ) -> Result<GitMergeProbe, CreationError> {
        fixed_relation(self.current(identity, protection)?, source)
    }
    pub fn prepare_git_merge(
        &mut self,
        identity: &str,
        source: &str,
        discard: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let probe = self.probe_git_merge(identity, source, protection)?;
        if probe.relation == GitMergeRelation::Included {
            return Ok(GitMergeCandidate {
                id: String::new(),
                revision: 0,
                relation: probe.relation,
                phase: GitMergePhase::Completed,
                source: probe.source,
                target: probe.target.clone(),
                base: probe.base,
                branch: probe.branch,
                name: String::new(),
                files: vec![],
                unresolved: 0,
                result: Some(probe.target),
                detail: None,
                assistant_owner: None,
                can_undo: false,
            });
        }
        ensure_editable(self.current(identity, protection)?)?;
        self.git_tasks_idle(identity, data, protection)?;
        if probe.dirty && discard {
            let preview =
                self.preview_git_switch(identity, &probe.target, true, data, protection)?;
            self.confirm_git_switch(identity, &preview.token, data, protection)?;
        }
        let probe = self.probe_git_merge(identity, source, protection)?;
        let project = self.current(identity, protection)?;
        let real = repository(project)?;
        require_clean(project, &real)?;
        let current = inventory(
            &real,
            real.find_commit(parse(&probe.target)?)
                .map_err(git)?
                .tree_id(),
        )?;
        let incoming = inventory(
            &real,
            real.find_commit(parse(&probe.source)?)
                .map_err(git)?
                .tree_id(),
        )?;
        validate_transition(&current, &incoming)?;
        let ancestor = probe
            .base
            .as_deref()
            .map(|base| {
                real.find_commit(parse(base)?)
                    .map_err(git)
                    .and_then(|commit| inventory(&real, commit.tree_id()))
            })
            .transpose()?
            .unwrap_or_default();
        let directory = tempfile::Builder::new()
            .prefix("merge-")
            .tempdir_in(private_root(project)?)
            .map_err(io_error)?;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
            .map_err(io_error)?;
        let id = directory
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| invalid("Invalid private merge name"))?
            .to_owned();
        let private = private_init(&directory.path().join("repository"))?;
        copy_inputs(
            &real,
            &private,
            &[parse(&probe.target)?, parse(&probe.source)?],
        )?;
        let source_name = git_version_names::display(
            &real,
            &real.find_commit(parse(&probe.source)?).map_err(git)?,
        )?
        .lines()
        .next()
        .unwrap_or("version")
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>();
        let mut record = Record {
            schema: 1,
            id: id.clone(),
            root: project.descriptor.root.clone(),
            root_key: root_key(project)?,
            revision: 1,
            phase: GitMergePhase::Active,
            relation: probe.relation,
            source: probe.source,
            target: probe.target,
            base: probe.base,
            branch: probe.branch,
            baseline: state_fingerprint(project, &real, &current)?,
            name: if probe.relation == GitMergeRelation::FastForward {
                source_name
            } else {
                format!("Merge {source_name}")
            },
            current,
            incoming,
            ancestor,
            entries: Entries::new(),
            conflicts: BTreeMap::new(),
            owner: None,
            checkpoint: None,
            pending_round: None,
            publication: None,
            detail: None,
        };
        merged(&private, &mut record)?;
        validate_transition(&record.current, &record.entries)?;
        let _ = tree(&private, &record.entries)?;
        sync_private_repository(&private)?;
        save(project, &record)?;
        if let Err(error) = write_json(&private_root(project)?.join(ACTIVE), &id) {
            if active_id(project).ok().flatten().as_deref() == Some(id.as_str()) {
                let _ = directory.keep();
                if let Some(project) = self.project.as_mut() {
                    project.merge_active = true;
                }
            }
            return Err(error);
        }
        let _ = directory.keep();
        self.git_merge_seen.insert(id);
        if let Some(project) = self.project.as_mut() {
            project.merge_active = true;
        }
        dto(self.current(identity, protection)?, &record)
    }
    pub fn get_git_merge(
        &mut self,
        identity: &str,
        protection: &Protection,
    ) -> Result<Option<GitMergeCandidate>, CreationError> {
        let project = self.current(identity, protection)?;
        let Some(id) = active_id(project)? else {
            return Ok(None);
        };
        let mut record = load(project, &id)?;
        if record.phase == GitMergePhase::Completed {
            if let Err(error) = super::publication::complete_attachments(project, &mut record) {
                record.detail = Some(format!(
                    "The merge is complete; attached cleanup needs retry: {}",
                    error.detail
                ));
                save(project, &record)?;
            }
        }
        if record.phase == GitMergePhase::Publishing {
            record.phase = GitMergePhase::Recovery;
            record.detail = Some("Continue recovery of the fixed merge result.".into());
            save(project, &record)?;
        }
        if !self.git_merge_seen.contains(&id) && record.phase == GitMergePhase::Active {
            record.phase = GitMergePhase::Paused;
            record.owner = None;
            record.pending_round = None;
            save(project, &record)?;
        }
        if matches!(record.phase, GitMergePhase::Active | GitMergePhase::Paused)
            && fresh(project, &record).is_err()
        {
            record.phase = GitMergePhase::Stale;
            bump(&mut record)?;
            record.owner = None;
            record.detail =
                Some("The actual project or target route changed. Reprepare this merge.".into());
            save(project, &record)?;
        }
        let mut reply = dto(project, &record)?;
        if reply.phase != record.phase {
            record.phase = reply.phase;
            record.detail = reply.detail.clone();
            record.owner = None;
            record.pending_round = None;
            bump(&mut record)?;
            save(project, &record)?;
            reply = dto(project, &record)?;
        }
        let cleanup_pending = record.phase == GitMergePhase::Completed
            && active_id(project)?.as_deref() == Some(id.as_str());
        if cleanup_pending {
            // Keep the terminal journal intact, but retain the UI's retry action
            // until attached cleanup has released actual-project admission.
            reply.phase = GitMergePhase::Recovery;
        }
        let completed = reply.phase == GitMergePhase::Completed && !cleanup_pending;
        self.git_merge_seen.insert(id);
        if completed {
            if let Some(project) = self.project.as_mut() {
                project.merge_active = false;
            }
        }
        Ok(Some(reply))
    }
    pub fn git_merge_fresh(
        &self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        fresh(project, &record)?;
        dto(project, &record)
    }
    pub fn resume_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        fresh(project, &record)?;
        if !matches!(record.phase, GitMergePhase::Active | GitMergePhase::Paused) {
            return Err(invalid("This merge cannot be resumed"));
        }
        if record.owner.is_some() {
            return Err(invalid("Stop the active merge assistant before resuming"));
        }
        record.phase = GitMergePhase::Active;
        record.owner = None;
        record.pending_round = None;
        save(project, &record)?;
        dto(project, &record)
    }
    pub fn pause_git_merge(
        &mut self,
        identity: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        if let Some(id) = active_id(project)? {
            let mut record = load(project, &id)?;
            if record.phase == GitMergePhase::Active {
                record.phase = GitMergePhase::Paused;
                record.owner = None;
                record.pending_round = None;
                save(project, &record)?;
            }
            self.git_merge_seen.remove(&id);
        }
        Ok(())
    }
    pub fn reprepare_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        data: &Path,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        if matches!(
            record.phase,
            GitMergePhase::Publishing | GitMergePhase::Recovery
        ) {
            return Err(invalid("Recover the published merge instead"));
        }
        let source = record.source.clone();
        self.cancel_git_merge(identity, id, revision, protection)?;
        self.prepare_git_merge(identity, &source, false, data, protection)
    }
    pub fn cancel_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        if record.owner.is_some() {
            return Err(invalid("Stop the merge assistant before cancelling"));
        }
        if matches!(
            record.phase,
            GitMergePhase::Publishing | GitMergePhase::Recovery
        ) {
            return Err(invalid(
                "Publication started; continue recovery instead of cancelling",
            ));
        }
        if active_id(project)?.as_deref() != Some(id) {
            return Err(conflict("This candidate is no longer active"));
        }
        let operation = operation_path(project, id)?;
        for entry in fs::read_dir(&operation).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            if entry.file_name() == "state.json" {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if metadata.is_dir() && !metadata.is_symlink() {
                fs::remove_dir_all(entry.path()).map_err(io_error)?;
            } else {
                fs::remove_file(entry.path()).map_err(io_error)?;
            }
        }
        let root = private_root(project)?;
        fs::remove_file(root.join(ACTIVE)).map_err(io_error)?;
        // The tombstone must reach storage before its referenced journal disappears.
        File::open(&root)
            .map_err(io_error)?
            .sync_all()
            .map_err(io_error)?;
        let _ = fs::remove_file(operation.join("state.json"));
        let _ = fs::remove_dir(&operation);
        self.git_merge_seen.remove(id);
        if let Some(project) = self.project.as_mut() {
            project.merge_active = false;
        }
        Ok(())
    }
    pub fn git_merge_paths(
        &self,
        identity: &str,
        id: &str,
        side: GitMergeSide,
        protection: &Protection,
    ) -> Result<Vec<String>, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        Ok(side_entries(&record, side).keys().cloned().collect())
    }
    pub fn read_git_merge_file(
        &self,
        identity: &str,
        id: &str,
        path: &str,
        side: GitMergeSide,
        protection: &Protection,
    ) -> Result<GitMergeContent, CreationError> {
        valid_path(path)?;
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        let repo = private_repository(project, &record)?;
        let entry = side_entries(&record, side).get(path);
        let bytes = entry.map(|entry| blob(&repo, entry)).transpose()?;
        let file_kind = kind(path, bytes.as_deref());
        let mime = match file_kind {
            GitMergeFileKind::Image => Some(
                match Path::new(path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                {
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    _ => "image/png",
                },
            ),
            GitMergeFileKind::Audio => Some(
                match Path::new(path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                {
                    "mp3" => "audio/mpeg",
                    "ogg" => "audio/ogg",
                    "flac" => "audio/flac",
                    "m4a" => "audio/mp4",
                    _ => "audio/wav",
                },
            ),
            _ => None,
        }
        .map(str::to_owned);
        let wave = bytes.as_deref().and_then(wav_metadata);
        let duration_ms = if file_kind == GitMergeFileKind::Audio {
            let mut copy = tempfile::Builder::new()
                .suffix(&format!(
                    ".{}",
                    Path::new(path)
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .unwrap_or("wav")
                ))
                .tempfile()
                .map_err(io_error)?;
            copy.write_all(bytes.as_deref().unwrap_or_default())
                .map_err(io_error)?;
            #[cfg(target_os = "macos")]
            let duration = crate::project::audio_preview::duration_ms(copy.path()).ok();
            #[cfg(not(target_os = "macos"))]
            let duration = None;
            duration
        } else {
            None
        };
        let text = if file_kind == GitMergeFileKind::Text {
            bytes
                .as_ref()
                .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        } else {
            None
        };
        let url = if file_kind == GitMergeFileKind::Image {
            bytes
                .as_ref()
                .filter(|bytes| bytes.len() <= IMAGE_MAX_BYTES as usize)
                .map(|bytes| {
                    format!(
                        "data:{};base64,{}",
                        mime.as_deref().unwrap_or("application/octet-stream"),
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    )
                })
        } else {
            None
        };
        Ok(GitMergeContent {
            path: path.into(),
            side,
            exists: entry.is_some(),
            version: entry_version(entry),
            text,
            url,
            size: bytes.as_ref().map_or(0.0, |bytes| bytes.len() as f64),
            mime,
            duration_ms: duration_ms.or_else(|| wave.as_ref().map(|metadata| metadata.0)),
            sample_rate: wave.as_ref().map(|metadata| metadata.1),
            channels: wave.as_ref().map(|metadata| metadata.2),
            waveform: wave.map(|metadata| metadata.3),
        })
    }
    pub fn edit_git_merge_owned(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        owner: Option<&str>,
        edits: Vec<GitMergeEdit>,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, owner)?;
        fresh(project, &record)?;
        if record.relation != GitMergeRelation::Diverged {
            return Err(invalid("Fast-forward candidates are read-only"));
        }
        let repo = private_repository(project, &record)?;
        let mut paths = BTreeSet::new();
        for edit in &edits {
            valid_path(&edit.path)?;
            if !paths.insert(&edit.path) {
                return Err(invalid("Duplicate merge edit path"));
            }
            if entry_version(record.entries.get(&edit.path)) != edit.version {
                return Err(conflict(format!("Merge file changed: {}", edit.path)));
            }
            if edit.choice.is_none()
                && edit
                    .text
                    .as_ref()
                    .is_some_and(|text| text.len() as u64 > TEXT_MAX_BYTES)
            {
                return Err(invalid("Merge text exceeds 1 MiB"));
            }
        }
        let before = record.entries.clone();
        let before_conflicts = record.conflicts.clone();
        for edit in edits {
            if let Some(choice) = edit.choice {
                let selected = match choice {
                    GitMergeChoice::Current => record.current.get(&edit.path),
                    GitMergeChoice::Incoming => record.incoming.get(&edit.path),
                    GitMergeChoice::Delete => None,
                }
                .cloned();
                if let Some(entry) = selected {
                    record.entries.insert(edit.path.clone(), entry);
                } else {
                    record.entries.remove(&edit.path);
                }
                if let Some(conflict) = record.conflicts.get_mut(&edit.path) {
                    conflict.resolved = true;
                }
            } else if let Some(text) = edit.text {
                if let Some(entry) = record.entries.get(&edit.path) {
                    if kind(&edit.path, Some(&blob(&repo, entry)?)) != GitMergeFileKind::Text {
                        return Err(invalid(
                            "The assistant and text editor cannot replace binary files",
                        ));
                    }
                }
                let mode = record
                    .entries
                    .get(&edit.path)
                    .map_or(0o100644, |entry| entry.mode);
                let oid = repo.blob(text.as_bytes()).map_err(git)?;
                record.entries.insert(
                    edit.path.clone(),
                    Entry {
                        oid: oid.to_string(),
                        mode,
                    },
                );
                if let Some(conflict) = record.conflicts.get_mut(&edit.path) {
                    if conflict.kind == GitMergeConflictKind::Text {
                        conflict.resolved = conflict
                            .markers
                            .as_ref()
                            .is_none_or(|marker| !text.contains(marker));
                    }
                }
            } else {
                record.entries.remove(&edit.path);
                if let Some(conflict) = record.conflicts.get_mut(&edit.path) {
                    conflict.resolved = true;
                }
            }
        }
        validate_transition(&record.current, &record.entries)?;
        let _ = tree(&repo, &record.entries)?;
        sync_private_repository(&repo)?;
        if before != record.entries || before_conflicts != record.conflicts {
            if owner.is_some() {
                if let Some(mut checkpoint) = record.pending_round.take() {
                    checkpoint.after = record.entries.clone();
                    checkpoint.after_conflicts = record.conflicts.clone();
                    record.checkpoint = Some(checkpoint);
                } else if let Some(checkpoint) = record.checkpoint.as_mut() {
                    checkpoint.after = record.entries.clone();
                    checkpoint.after_conflicts = record.conflicts.clone();
                }
            }
            bump(&mut record)?;
        }
        save(project, &record)?;
        dto(project, &record)
    }
    pub fn rename_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        name: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, None)?;
        fresh(project, &record)?;
        let name = name.trim();
        if name.is_empty() || name.len() > 1000 || name.contains(['\0', '\n', '\r']) {
            return Err(invalid("Enter a nonempty merge name up to 1000 bytes"));
        }
        if record.relation == GitMergeRelation::FastForward {
            return Err(invalid("Fast-forward keeps the incoming version name"));
        }
        record.name = name.into();
        save(project, &record)?;
        dto(project, &record)
    }
    pub fn validate_git_merge(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, None)?;
        fresh(project, &record)?;
        mandatory(&private_repository(project, &record)?, &record)?;
        dto(project, &record)
    }
    pub fn prepare_git_merge_snapshot(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        require_resolved: bool,
        protection: &Protection,
    ) -> Result<GitMergeSnapshot, CreationError> {
        self.prepare_git_merge_snapshot_owned(
            identity,
            id,
            revision,
            require_resolved,
            None,
            protection,
        )
    }
    pub fn prepare_git_merge_snapshot_owned(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        require_resolved: bool,
        owner: Option<&str>,
        protection: &Protection,
    ) -> Result<GitMergeSnapshot, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, owner)?;
        fresh(project, &record)?;
        let repo = private_repository(project, &record)?;
        if require_resolved {
            mandatory(&repo, &record)?;
        }
        let directory = tempfile::Builder::new()
            .prefix("run-")
            .tempdir_in(operation_path(project, id)?)
            .map_err(io_error)?;
        materialize(&repo, &record.entries, directory.path())?;
        let candidate = dto(project, &record)?;
        let fingerprint = tree(&repo, &record.entries)?.to_string();
        let managed_paths = record
            .current
            .keys()
            .chain(record.incoming.keys())
            .chain(record.ancestor.keys())
            .chain(record.entries.keys())
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        Ok(GitMergeSnapshot {
            candidate,
            project_root: project.root.clone(),
            fingerprint,
            root: directory.path().to_path_buf(),
            _directory: directory,
            managed_paths,
        })
    }
    pub fn git_merge_records_directory(
        &self,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<PathBuf, CreationError> {
        let project = self.current(identity, protection)?;
        let _ = load(project, id)?;
        operation_path(project, id)
    }
    pub fn adopt_git_merge_artifacts(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        artifacts: Vec<GitMergeArtifact>,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, None)?;
        fresh(project, &record)?;
        if record.relation != GitMergeRelation::Diverged {
            return Err(invalid(
                "Fast-forward candidates cannot adopt compiled artifacts",
            ));
        }
        let repo = private_repository(project, &record)?;
        for artifact in artifacts {
            valid_path(&artifact.path)?;
            if !artifact.path.ends_with(".scsyndef")
                || artifact.bytes.len() as u64 > local_git::GIT_FILE_LIMIT
            {
                return Err(invalid("Only bounded SynthDef artifacts can be adopted"));
            }
            let id = repo.blob(&artifact.bytes).map_err(git)?;
            record.entries.insert(
                artifact.path,
                Entry {
                    oid: id.to_string(),
                    mode: 0o100644,
                },
            );
        }
        validate_transition(&record.current, &record.entries)?;
        let _ = tree(&repo, &record.entries)?;
        sync_private_repository(&repo)?;
        bump(&mut record)?;
        save(project, &record)?;
        dto(project, &record)
    }
    pub fn begin_git_merge_round(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeRound, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, None)?;
        fresh(project, &record)?;
        if record.relation != GitMergeRelation::Diverged {
            return Err(invalid("Fast-forward assistance is read-only"));
        }
        let round_directory = tempfile::Builder::new()
            .prefix("round-")
            .tempdir_in(operation_path(project, id)?)
            .map_err(io_error)?;
        let round = round_directory
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| invalid("Invalid assistant round"))?
            .to_owned();
        let _ = round_directory.keep();
        record.owner = Some(round.clone());
        record.pending_round = Some(Checkpoint {
            id: round.clone(),
            before: record.entries.clone(),
            after: record.entries.clone(),
            before_conflicts: record.conflicts.clone(),
            after_conflicts: record.conflicts.clone(),
        });
        save(project, &record)?;
        Ok(GitMergeRound {
            id: round,
            candidate: dto(project, &record)?,
        })
    }
    pub fn end_git_merge_round(
        &mut self,
        identity: &str,
        id: &str,
        round: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        if record.owner.as_deref() != Some(round) {
            return Err(conflict(
                "This merge assistant round no longer owns the candidate",
            ));
        }
        record.owner = None;
        record.pending_round = None;
        save(project, &record)?;
        dto(project, &record)
    }
    pub fn undo_git_merge_round(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        require_revision(&record, revision)?;
        require_active(&record, None)?;
        fresh(project, &record)?;
        let checkpoint = record
            .checkpoint
            .clone()
            .ok_or_else(|| invalid("There is no merge assistant change to undo"))?;
        let mut paths = changed_paths(&checkpoint.before, &checkpoint.after)
            .into_iter()
            .collect::<BTreeSet<_>>();
        for path in checkpoint
            .before_conflicts
            .keys()
            .chain(checkpoint.after_conflicts.keys())
        {
            if checkpoint.before_conflicts.get(path) != checkpoint.after_conflicts.get(path) {
                paths.insert(path.clone());
            }
        }
        if paths.iter().any(|path| {
            record.entries.get(path) != checkpoint.after.get(path)
                || record.conflicts.get(path) != checkpoint.after_conflicts.get(path)
        }) {
            return Err(conflict(
                "Later manual edits overlap this round; the whole undo was refused",
            ));
        }
        for path in paths {
            if let Some(entry) = checkpoint.before.get(&path) {
                record.entries.insert(path.clone(), entry.clone());
            } else {
                record.entries.remove(&path);
            }
            if let Some(conflict) = checkpoint.before_conflicts.get(&path) {
                record.conflicts.insert(path, conflict.clone());
            }
        }
        record.checkpoint = None;
        bump(&mut record)?;
        save(project, &record)?;
        dto(project, &record)
    }
}
fn side_entries(record: &Record, side: GitMergeSide) -> &Entries {
    match side {
        GitMergeSide::Base => &record.ancestor,
        GitMergeSide::Current => &record.current,
        GitMergeSide::Incoming => &record.incoming,
        GitMergeSide::Result => &record.entries,
    }
}
impl CreationAccess {
    pub fn pause_git_merge_candidate(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        if record.owner.is_some() {
            return Err(invalid("Stop the merge assistant before leaving"));
        }
        self.pause_git_merge(identity, protection)?;
        let project = self.current(identity, protection)?;
        dto(project, &load(project, id)?)
    }
    pub fn require_no_git_merge(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        require_no_candidate(self.current(identity, protection)?)
    }
    pub fn require_git_merge_assistant_owner(
        &self,
        identity: &str,
        id: &str,
        owner: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_active(&record, Some(owner))?;
        fresh(project, &record)
    }
    pub fn prepare_git_merge_assistant_snapshot(
        &mut self,
        identity: &str,
        id: &str,
        revision: u32,
        owner: &str,
        require_resolved: bool,
        protection: &Protection,
    ) -> Result<GitMergeSnapshot, CreationError> {
        self.prepare_git_merge_snapshot_owned(
            identity,
            id,
            revision,
            require_resolved,
            Some(owner),
            protection,
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_git_merge_audio(
        &self,
        identity: &str,
        id: &str,
        revision: u32,
        path: &str,
        side: GitMergeSide,
        version: &str,
        protection: &Protection,
    ) -> Result<tempfile::NamedTempFile, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        fresh(project, &record)?;
        valid_path(path)?;
        let entry = side_entries(&record, side)
            .get(path)
            .ok_or_else(|| CreationError::new(CreationErrorCode::Missing, path))?;
        if entry_version(Some(entry)) != version {
            return Err(conflict("The selected merge audio changed"));
        }
        let bytes = blob(&private_repository(project, &record)?, entry)?;
        if kind(path, Some(&bytes)) != GitMergeFileKind::Audio {
            return Err(invalid("This merge file is not supported audio"));
        }
        let extension = Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("wav");
        let mut copy = tempfile::Builder::new()
            .prefix("merge-audio-")
            .suffix(&format!(".{extension}"))
            .tempfile_in(operation_path(project, id)?)
            .map_err(io_error)?;
        copy.write_all(&bytes).map_err(io_error)?;
        copy.as_file().sync_all().map_err(io_error)?;
        let (mime, _) = materials::audio_format(path)
            .ok_or_else(|| invalid("Unsupported merge audio format"))?;
        let media = CreationPendingMedia {
            id: "merge".into(),
            name: Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path)
                .into(),
            version: hash(&bytes),
            size: bytes.len() as u32,
            mime: mime.into(),
            duration_ms: None,
            width: None,
            height: None,
        };
        materials::verify_audio(copy.as_file_mut(), &media)
            .map_err(|_| invalid("The merge audio signature or private copy is invalid"))?;
        #[cfg(target_os = "macos")]
        crate::project::audio_preview::duration_ms(copy.path())
            .map_err(|_| invalid("The selected merge file is not valid playable audio"))?;
        let mut grants = project.merge_audio_grants.borrow_mut();
        let grant = GitMergeAudioGrant {
            id: id.into(),
            revision,
            path: path.into(),
            side,
            version: version.into(),
        };
        if !grants.contains(&grant) {
            if grants.len() >= 16 {
                grants.remove(0);
            }
            grants.push(grant);
        }
        Ok(copy)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn validate_git_merge_audio_preview(
        &self,
        identity: &str,
        id: &str,
        revision: u32,
        path: &str,
        side: GitMergeSide,
        version: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let project = self.current(identity, protection)?;
        if active_id(project)?.as_deref() != Some(id) {
            return Err(conflict("The merge audio candidate is no longer active"));
        }
        let grant = GitMergeAudioGrant {
            id: id.into(),
            revision,
            path: path.into(),
            side,
            version: version.into(),
        };
        if !project.merge_audio_grants.borrow().contains(&grant) {
            return Err(conflict("The private merge audio authorization changed"));
        }
        Ok(())
    }
    pub fn read_git_merge_diff(
        &self,
        identity: &str,
        id: &str,
        revision: u32,
        path: &str,
        full_context: bool,
        protection: &Protection,
    ) -> Result<GitComparisonDiff, CreationError> {
        let project = self.current(identity, protection)?;
        let record = load(project, id)?;
        require_revision(&record, revision)?;
        let repo = private_repository(project, &record)?;
        valid_path(path)?;
        let before = record
            .current
            .get(path)
            .map(|entry| blob(&repo, entry))
            .transpose()?
            .unwrap_or_default();
        let after = record
            .entries
            .get(path)
            .map(|entry| blob(&repo, entry))
            .transpose()?
            .unwrap_or_default();
        git_comparison::compare_bytes(
            &format!("{}:{revision}", record.id),
            path,
            &before,
            &after,
            full_context,
        )
    }
}

impl CreationAccess {
    pub fn note_git_merge_warning(
        &mut self,
        identity: &str,
        id: &str,
        warning: &str,
        protection: &Protection,
    ) -> Result<GitMergeCandidate, CreationError> {
        let project = self.current(identity, protection)?;
        let mut record = load(project, id)?;
        if record.phase != GitMergePhase::Completed {
            return Err(invalid("Only completed merges may attach a backup receipt"));
        }
        if !warning.is_empty()
            && !record
                .detail
                .as_ref()
                .is_some_and(|existing| existing.contains(warning))
        {
            record.detail = Some(record.detail.map_or_else(
                || warning.into(),
                |existing| format!("{existing}\n{warning}"),
            ));
            save(project, &record)?;
        }
        dto(project, &record)
    }
}

impl CreationAccess {
    pub fn pause_current_git_merge_for_exit(&mut self) -> Result<(), CreationError> {
        if let Some(project) = self.project.as_ref() {
            if let Some(id) = super::pause_for_exit(project)? {
                self.git_merge_seen.remove(&id);
            }
        }
        Ok(())
    }
}
