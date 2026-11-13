//! The last complete integration survives task retirement in the private project folder.
use super::super::materials as documents;
use super::*;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingIntegrationSource {
    pub id: String,
    pub version: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingIntegrationTarget {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingIntegrationCompletion {
    pub sources: Vec<PendingIntegrationSource>,
    pub targets: Vec<PendingIntegrationTarget>,
    pub check_task_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PendingIntegrationVerification {
    Passed,
    Unverified,
}

/// App-owned availability and installed-resource facts. The project domain
/// derives verification from saved inputs and native receipts, never a caller's
/// claimed Passed/Unverified result.
pub struct PendingIntegrationEnvironment<'a> {
    pub shared_root: Option<&'a Path>,
    pub active_performance: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingIntegrationReceipt {
    pub task_id: String,
    pub sources: Vec<CreationMaterial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub media_sources: Option<Vec<documents::CreationPendingMedia>>,
    pub targets: Vec<PendingIntegrationTarget>,
    pub verification: PendingIntegrationVerification,
    pub reason: String,
    pub restored: bool,
}

#[derive(Serialize, Deserialize)]
struct Recovery {
    schema: u32,
    receipt: PendingIntegrationReceipt,
    originals: Vec<documents::MaterialCopy>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    original_images: Vec<documents::CreationPendingMedia>,
    journal: Journal,
    #[serde(default)]
    restore_task: Option<String>,
}

fn failure(error: MaterialError) -> CreationError {
    invalid(format!("Pending documents: {error:?}"))
}

fn read_recovery(directory: &File, name: &str) -> Result<Option<Recovery>, CreationError> {
    let recovery =
        documents::read_private::<Recovery>(directory, name, 64 * 1024 * 1024).map_err(failure)?;
    if let Some(recovery) = &recovery {
        if recovery.schema != 1
            || recovery.originals.len() + recovery.original_images.len() > 64
            || recovery
                .receipt
                .media_sources
                .as_deref()
                .unwrap_or_default()
                != recovery.original_images
            || recovery.receipt.sources.len() != recovery.originals.len()
            || !valid_assistant_task_id(&recovery.receipt.task_id)
        {
            return Err(invalid("Invalid pending integration recovery"));
        }
        let mut ids = std::collections::HashSet::new();
        for original in &recovery.originals {
            documents::validate_copy(original).map_err(failure)?;
            if !ids.insert(&original.material.id)
                || !recovery.receipt.sources.iter().any(|source| {
                    source.id == original.material.id
                        && source.version == original.material.version
                        && source.name == original.material.name
                })
            {
                return Err(invalid("Invalid pending original recovery"));
            }
        }
        for image in &recovery.original_images {
            if !ids.insert(&image.id)
                || !recovery.journal.image_adoptions.iter().any(|receipt| {
                    receipt.material_id == image.id && receipt.material_version == image.version
                })
            {
                return Err(invalid("Invalid pending image recovery"));
            }
        }
        recovery.journal.validate_material_conflicts()?;
        recovery.journal.validate_image_adoptions()?;
        recovery.journal.validate_media_artifacts()?;
        recovery.journal.validate_questions()?;
    }
    Ok(recovery)
}

fn persist(directory: &File, name: &str, recovery: &Recovery) -> Result<(), CreationError> {
    let bytes = serde_json::to_vec(recovery).map_err(|cause| invalid(cause.to_string()))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(invalid("Integration recovery is full"));
    }
    documents::publish_bytes(directory, name, &bytes).map_err(failure)
}

pub(super) fn recovery_holds_media_backups(
    project: &OpenProject,
    journal: &Journal,
) -> Result<(), CreationError> {
    if journal.media_artifacts.is_empty() {
        return Ok(());
    }
    let directory = crate::creation_data::open(&project.directory).map_err(io_error)?;
    let current = read_recovery(&directory, "pending-integration.json")?;
    let next = read_recovery(&directory, "pending-integration-next.json")?;
    media_artifacts::reclaim_media_backups(project, journal, |backup| {
        [&current, &next].into_iter().flatten().any(|recovery| {
            recovery
                .journal
                .media_artifacts
                .iter()
                .any(|entry| entry.references_backup(backup))
        })
    })
}

fn finalize(
    project: &OpenProject,
    data: &Path,
    directory: &File,
    recovery: &Recovery,
    collection: &documents::MaterialCollection,
) -> Result<(), CreationError> {
    let previous = read_recovery(directory, "pending-integration.json")?;
    documents::update_pending_media_originals(directory, &recovery.original_images, false, true)
        .map_err(failure)?;
    documents::publish(directory, collection).map_err(failure)?;
    persist(directory, "pending-integration.json", recovery)?;
    documents::unlink(directory, "pending-integration-next.json").map_err(failure)?;
    if let Some(previous) = previous {
        let previous_task_is_live = match load_raw(data, &project.root, &previous.receipt.task_id) {
            Ok(journal) => !journal.retired,
            Err(error) => error.code != CreationErrorCode::Missing,
        };
        if !previous_task_is_live {
            let _ = recovery_holds_media_backups(project, &previous.journal);
        }
        documents::reclaim_retired_media_originals(
            directory,
            &previous.original_images,
            &recovery.original_images,
        );
    }
    Ok(())
}

/// Compare the complete immutable task, allowing only durable undo progress and
/// its relocated filesystem owner to differ from the completion snapshot.
fn restore_basis(journal: &Journal) -> Result<serde_json::Value, CreationError> {
    let mut value = serde_json::to_value(journal).map_err(|cause| invalid(cause.to_string()))?;
    let object = value.as_object_mut().expect("journal is an object");
    for name in ["root", "directory_identity", "id", "undoing", "compilation"] {
        object.remove(name);
    }
    for (collection, progress) in [
        ("entries", &["undone"][..]),
        (
            "directories",
            &["undone", "directory_identity", "pending_remove"][..],
        ),
        ("artifacts", &["undone", "pending_undo"][..]),
        ("media_artifacts", &["undone", "undoing"][..]),
        ("questions", &["taskId"][..]),
    ] {
        if let Some(entries) = object
            .get_mut(collection)
            .and_then(|value| value.as_array_mut())
        {
            for entry in entries {
                let entry = entry.as_object_mut().expect("journal entry is an object");
                for name in progress {
                    entry.remove(*name);
                }
            }
        }
    }
    Ok(value)
}

fn prepare_restore(
    recovery: &mut Recovery,
    project: &OpenProject,
    private_data: &Path,
) -> Result<String, CreationError> {
    let restore_id = format!("pending-restore-{}", recovery.receipt.task_id);
    if let Some(saved) = &recovery.restore_task {
        if saved != &restore_id {
            return Err(invalid("Invalid pending restore task"));
        }
        let directory = private_recovery_directory(private_data, &project.root, true)?
            .expect("project-private recovery path");
        let journal = match read_record(&directory, &restore_id)? {
            Some(journal) => journal,
            None => {
                // Older builds nested private journals below the old absolute
                // root's digest. Open that namespace only inside this project's
                // held private directory; never revisit the former project path.
                let digest = format!(
                    "{:x}",
                    Sha256::digest(recovery.journal.root.as_os_str().as_bytes())
                );
                let legacy = documents::open_directory_at(&directory, &digest).map_err(failure)?;
                let journal = read_record(&legacy, &restore_id)?
                    .ok_or_else(|| invalid("Missing interrupted pending restore"))?;
                if journal.root != recovery.journal.root
                    || journal.directory_identity != recovery.journal.directory_identity
                {
                    return Err(invalid("Invalid pending restore owner"));
                }
                journal
            }
        };
        if journal.retired || restore_basis(&journal)? != restore_basis(&recovery.journal)? {
            return Err(invalid("Invalid pending restore task ownership"));
        }
        recovery.journal = journal;
    }
    let metadata = project.directory.metadata().map_err(io_error)?;
    let directory_identity = format!("{}:{}", metadata.dev(), metadata.ino());
    if recovery.journal.root != project.root
        || recovery.journal.directory_identity != directory_identity
    {
        for directory in &mut recovery.journal.directories {
            directory.rebind_relocated_restore(project)?;
        }
    }
    recovery.journal.root = project.root.clone();
    recovery.journal.directory_identity = directory_identity;
    recovery.journal.id = restore_id.clone();
    for question in &mut recovery.journal.questions {
        question.task_id.clone_from(&restore_id);
    }
    recovery.journal.retired = false;
    // Publish progress at a portable location before rebinding the recovery
    // pointer. Reopening always sees this latest journal, even if interrupted
    // before the outer record is replaced.
    recovery.journal.persist(private_data)?;
    recovery.restore_task = Some(restore_id.clone());
    Ok(restore_id)
}

fn relative_media_path(parent: &Path, literal: &str) -> Option<String> {
    if literal.contains('\\') || literal.contains(':') {
        return None;
    }
    let mut normalized = parent.to_path_buf();
    for part in Path::new(literal).components() {
        match part {
            Component::Normal(name) => normalized.push(name),
            Component::CurDir => {}
            Component::ParentDir if normalized.pop() => {}
            _ => return None,
        }
    }
    normalized.to_str().map(str::to_owned)
}

fn saved_media_literals(text: &str) -> Vec<(&str, &str)> {
    let mut remaining = text;
    let mut literals = Vec::new();
    while let Some(index) = remaining.find(['/', '\'', '"', '`', '<']) {
        remaining = &remaining[index..];
        if let Some((start, end)) = [("//", "\n"), ("/*", "*/"), ("<!--", "-->")]
            .into_iter()
            .find(|(start, _)| remaining.starts_with(start))
        {
            remaining = remaining[start.len()..]
                .split_once(end)
                .map_or("", |(_, rest)| rest);
            continue;
        }
        let delimiter = remaining.as_bytes()[0] as char;
        let offset = text.len() - remaining.len();
        remaining = &remaining[1..];
        if matches!(delimiter, '\'' | '"' | '`') {
            let Some((value, rest)) = remaining.split_once(delimiter) else {
                break;
            };
            literals.push((value, &text[..offset]));
            remaining = rest;
        }
    }
    literals
}

fn sample_read_literal(prefix: &str) -> bool {
    let statement = prefix.rsplit(';').next().unwrap_or(prefix);
    let (call, args) = match statement.rsplit_once('(') {
        Some(call) => call,
        None => return false,
    };
    let call = call.trim_end();
    if (call.ends_with("Buffer.read") || call.ends_with("Buffer.readChannel"))
        && !args.contains(')')
        && args.split(',').count() <= 2
    {
        return true;
    }
    let osc_command = [
        "'/b_allocRead'",
        r#""/b_allocRead""#,
        "'/b_allocReadChannel'",
        r#""/b_allocReadChannel""#,
    ];
    osc_command.iter().any(|command| {
        statement
            .rsplit_once(command)
            .is_some_and(|(sender, args)| {
                (sender.contains("send(") || sender.contains("args:")) && !args.contains([')', ']'])
            })
    })
}

impl CreationAccess {
    fn pending_integration_proof(
        &self,
        identity: &str,
        task_id: &str,
        completion: &PendingIntegrationCompletion,
        environment: PendingIntegrationEnvironment<'_>,
        data: &Path,
        protection: &Protection,
    ) -> Result<(PendingIntegrationVerification, String), CreationError> {
        use crate::project::controlled_checks::{load_report_receipt, ControlledCheckStatus};
        self.authorize_assistant_check(identity, task_id, data, protection)?;
        let project = self.current(identity, protection)?;
        let diagnostics =
            crate::project::diagnostics::diagnose_project(&project.root, environment.shared_root);
        if !diagnostics.static_passed {
            return Err(invalid("Static checks failed; retain every pending source and report partial saved changes"));
        }
        if let Some(check_id) = &completion.check_task_id {
            let report = load_report_receipt(data, &project.root, check_id).map_err(invalid)?;
            if !matches!(
                report.status,
                ControlledCheckStatus::Passed | ControlledCheckStatus::NotExecuted
            ) {
                return Err(invalid(
                    "The runtime check failed or was cancelled; pending originals were retained",
                ));
            }
            if report.node_tests.is_some()
                || (report.status == ControlledCheckStatus::Passed && report.health.is_none())
            {
                return Err(invalid("Project tests alone do not verify runtime integration; provide the controlled runtime-check receipt"));
            }
            let evidence = report
                .evidence
                .as_ref()
                .ok_or_else(|| invalid("The check has no saved-input evidence"))?;
            let freshness = crate::project::check_evidence::source_freshness(
                &project.root,
                environment.shared_root,
                evidence,
                &std::sync::atomic::AtomicBool::new(false),
            );
            if report.status == ControlledCheckStatus::Passed {
                let mut expected =
                    self.pending_image_check_inputs(identity, task_id, data, protection)?;
                expected
                    .extend(self.pending_audio_check_inputs(identity, task_id, data, protection)?);
                for (path, version) in expected {
                    if !report.loaded_media.as_ref().is_some_and(|loaded| {
                        loaded
                            .iter()
                            .any(|asset| asset.path == path && asset.sha256 == version)
                    }) {
                        return Err(invalid(format!(
                            "The controlled check did not load adopted media {path}"
                        )));
                    }
                }
            }
            if freshness.stale || !freshness.complete || !report.cleanup.errors.is_empty() {
                return Err(invalid("The check is stale or cleanup is unconfirmed"));
            }
            return Ok(if report.status == ControlledCheckStatus::Passed {
                let reason = if report
                    .loaded_sample_sha256
                    .as_ref()
                    .is_some_and(|samples| !samples.is_empty())
                {
                    "Saved inputs passed their controlled checks. The isolated scsynth probe read the adopted WAV buffer; the score's trigger and physical sound still require verification"
                } else {
                    "Saved inputs passed their controlled runtime check; physical sound and visuals remain unverified"
                };
                (PendingIntegrationVerification::Passed, reason.into())
            } else {
                (
                    PendingIntegrationVerification::Unverified,
                    report
                        .error
                        .unwrap_or_else(|| "The runtime check is unavailable".into()),
                )
            });
        }
        if self.pending_task_document_only(identity, task_id, data, protection)? {
            return Ok((
                PendingIntegrationVerification::Unverified,
                "Documentation-only integration; runtime behavior was not checked".into(),
            ));
        }
        if environment.active_performance {
            return Ok((
                PendingIntegrationVerification::Unverified,
                "A running performance blocks checking the newly saved inputs".into(),
            ));
        }
        Err(invalid(
            "Run a controlled check before completing source integration",
        ))
    }

    /// Verify every saved task change and reference before consuming any source.
    pub fn complete_pending_integration(
        &mut self,
        identity: &str,
        task_id: &str,
        completion: &PendingIntegrationCompletion,
        environment: PendingIntegrationEnvironment<'_>,
        data: &Path,
        protection: &Protection,
    ) -> Result<PendingIntegrationReceipt, CreationError> {
        let proof = self.pending_integration_proof(
            identity,
            task_id,
            completion,
            environment,
            data,
            protection,
        )?;
        self.authorize_assistant_task(identity, task_id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        self.reconcile_assistant_journal(identity, &mut journal, data, protection)?;
        let saved_files = self.verified_assistant_journal_files(identity, &journal, protection)?;
        if completion.sources.is_empty()
            || completion.sources.len() > 64
            || completion.targets.len() > 128
            || journal.pending_selections.iter().any(|selection| {
                !completion
                    .sources
                    .iter()
                    .any(|source| source.id == selection.id && source.version == selection.version)
            })
            || journal.pending_sources.len() != completion.sources.len()
            || journal
                .pending_sources
                .iter()
                .any(|source| !completion.sources.contains(source))
            || journal
                .questions
                .iter()
                .any(|question| question.status == AssistantQuestionStatus::Pending)
        {
            return Err(invalid(
                "Complete all selected pending sources and task questions first",
            ));
        }
        let project = self.current(identity, protection)?;
        let mut paths = std::collections::HashSet::new();
        for target in &completion.targets {
            if !paths.insert(&target.path) {
                return Err(invalid("Duplicate integration target"));
            }
            if saved_files
                .iter()
                .any(|file| file.path == target.path && file.version == target.version)
            {
                continue;
            }
            if let Some(audio) = journal.image_adoptions.iter().find(|receipt| {
                receipt.path == target.path && documents::audio_format(&receipt.path).is_some()
            }) {
                if target.version.as_ref() == Some(&audio.version)
                    && media_artifacts::media_digest(project, &target.path)?
                        .is_some_and(|digest| digest.hash == audio.version)
                {
                    continue;
                }
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &target.path,
                ));
            }
            if let Some(image) = journal
                .image_adoptions
                .iter()
                .find(|receipt| receipt.path == target.path)
            {
                let current = compilation::artifact_bytes(project, &target.path)?
                    .ok_or_else(|| invalid("Saved image is missing"))?;
                if target.version.as_ref() == Some(&image.version)
                    && file_version(&current) == image.version
                    && format!("{:x}", Sha256::digest(&current)) == image.candidate_sha256
                {
                    continue;
                }
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &target.path,
                ));
            }
            match (
                self.read(identity, &target.path, protection),
                &target.version,
            ) {
                (Ok(CreationContent::Text { version, .. }), Some(expected))
                    if version == *expected => {}
                (Err(cause), None) if cause.code == CreationErrorCode::Missing => {}
                _ => {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &target.path,
                    ))
                }
            }
        }
        for entry in &journal.entries {
            if entry.undone
                || entry.pending.is_some()
                || entry.pending_remove
                || !paths.contains(&entry.path)
            {
                return Err(invalid(
                    "Completion must include the entire saved Work task",
                ));
            }
        }
        for source in &completion.sources {
            if !completion
                .targets
                .iter()
                .any(|target| target.path == source.path && target.version.is_some())
            {
                return Err(invalid("Missing saved integration destination"));
            }
        }
        let directory = self
            .materials_path(data, identity, protection)
            .map_err(failure)?;
        if read_recovery(&directory, "pending-integration-next.json")?.is_some() {
            return Err(invalid(
                "Recover the interrupted integration before starting another",
            ));
        }
        let mut collection = documents::load(&directory).map_err(failure)?;
        let mut originals = vec![];
        let mut original_images = vec![];
        let audio_paths: Vec<_> = journal
            .image_adoptions
            .iter()
            .filter(|receipt| documents::audio_format(&receipt.path).is_some())
            .map(|receipt| receipt.path.as_str())
            .collect();
        for source in &completion.sources {
            if let Some(image) = journal.image_adoptions.iter().find(|receipt| {
                receipt.material_id == source.id
                    && receipt.material_version == source.version
                    && receipt.path == source.path
            }) {
                let audio = audio_paths.contains(&source.path.as_str());
                let exact = if audio {
                    media_artifacts::media_digest(project, &source.path)?
                        .is_some_and(|digest| digest.hash == image.candidate_sha256)
                } else {
                    compilation::artifact_bytes(project, &source.path)?.is_some_and(|current| {
                        file_version(&current) == image.version
                            && format!("{:x}", Sha256::digest(&current)) == image.candidate_sha256
                    })
                };
                if !exact
                    || !completion.targets.iter().any(|target| {
                        target.path == source.path
                            && target.version.as_ref() == Some(&image.version)
                    })
                {
                    return Err(CreationError::new(
                        CreationErrorCode::VersionConflict,
                        &source.path,
                    ));
                }
                self.verify_saved_media_reference(
                    identity,
                    &completion.targets,
                    &source.path,
                    protection,
                )?;
                let metadata = if audio {
                    self.prepare_pending_audio(identity, &source.id, &source.version, protection)
                        .map_err(failure)?
                        .1
                } else {
                    self.pending_image_metadata(identity, &source.id, &source.version, protection)
                        .map_err(failure)?
                };
                original_images.push(metadata);
                continue;
            }
            if originals
                .iter()
                .any(|copy: &documents::MaterialCopy| copy.material.id == source.id)
            {
                continue;
            }
            let copy = collection
                .materials
                .iter()
                .find(|copy| {
                    copy.material.id == source.id && copy.material.version == source.version
                })
                .ok_or_else(|| invalid("Pending source changed before completion"))?;
            originals.push(copy.clone());
        }
        documents::update_pending_media_originals(&directory, &original_images, false, false)
            .map_err(failure)?;
        let mut targets = completion.targets.clone();
        for file in saved_files {
            if journal
                .artifacts
                .iter()
                .any(|artifact| artifact.path == file.path)
                && !targets.iter().any(|target| target.path == file.path)
            {
                targets.push(PendingIntegrationTarget {
                    path: file.path,
                    version: file.version,
                });
            }
        }
        let receipt = PendingIntegrationReceipt {
            task_id: task_id.into(),
            sources: originals.iter().map(|copy| copy.material.clone()).collect(),
            media_sources: (!original_images.is_empty()).then(|| original_images.clone()),
            targets,
            verification: proof.0,
            reason: proof.1,
            restored: false,
        };
        journal.pending_completed = true;
        let recovery = Recovery {
            schema: 1,
            receipt: receipt.clone(),
            originals,
            original_images,
            journal,
            restore_task: None,
        };
        // Keep the previous successful receipt until the new sources are durably moved out.
        persist(&directory, "pending-integration-next.json", &recovery)?;
        recovery.journal.persist(data)?;
        self.end_assistant_task(identity, task_id);
        collection.materials.retain(|copy| {
            !recovery
                .originals
                .iter()
                .any(|source| source.material.id == copy.material.id)
        });
        finalize(
            self.current(identity, protection)?,
            data,
            &directory,
            &recovery,
            &collection,
        )?;
        Ok(receipt)
    }

    fn verify_saved_media_reference(
        &self,
        identity: &str,
        targets: &[PendingIntegrationTarget],
        path: &str,
        protection: &Protection,
    ) -> Result<(), CreationError> {
        let public_route = path.strip_prefix("public/");
        for target in targets {
            if image_mime(&target.path).is_some()
                || target.version.is_none()
                || !matches!(
                    Path::new(&target.path)
                        .extension()
                        .and_then(|value| value.to_str()),
                    Some("js" | "mjs" | "cjs" | "ts" | "html" | "htm" | "css" | "json" | "scd")
                )
            {
                continue;
            }
            if let Ok(CreationContent::Text { text, version, .. }) =
                self.read(identity, &target.path, protection)
            {
                if target.version.as_ref() != Some(&version) {
                    continue;
                }
                let root = Path::new(&target.path).parent().unwrap_or(Path::new(""));
                let literals = saved_media_literals(&text);
                let sample = crate::project::controlled_checks::is_supercollider_sample(path);
                let matches = |literal: &str| {
                    let literal = literal.strip_prefix('/').unwrap_or(literal);
                    literal == path
                        || public_route == Some(literal)
                        || relative_media_path(root, literal).as_deref() == Some(path)
                };
                if literals.iter().any(|(literal, prefix)| {
                    if sample {
                        sample_read_literal(prefix) && matches(literal)
                    } else {
                        matches(literal)
                            || (literal.contains('<')
                                && saved_media_literals(literal)
                                    .iter()
                                    .any(|(nested, _)| matches(nested)))
                    }
                }) {
                    return Ok(());
                }
            }
        }
        Err(invalid(format!(
            "Include a saved performer or sample reference to {path}"
        )))
    }

    pub fn pending_integration(
        &mut self,
        identity: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Option<PendingIntegrationReceipt>, CreationError> {
        let directory = self
            .materials_path(data, identity, protection)
            .map_err(failure)?;
        if let Some(recovery) = read_recovery(&directory, "pending-integration-next.json")? {
            recovery.journal.persist(data)?;
            self.end_assistant_task(identity, &recovery.receipt.task_id);
            let mut collection = documents::load(&directory).map_err(failure)?;
            for original in &recovery.originals {
                if collection.materials.iter().any(|copy| {
                    copy.material.id == original.material.id
                        && (copy.material.version != original.material.version
                            || copy.material.name != original.material.name)
                }) {
                    return Err(invalid(
                        "Interrupted integration conflicts with a newer pending document",
                    ));
                }
            }
            collection.materials.retain(|copy| {
                !recovery
                    .originals
                    .iter()
                    .any(|source| source.material.id == copy.material.id)
            });
            finalize(
                self.current(identity, protection)?,
                data,
                &directory,
                &recovery,
                &collection,
            )?;
        }
        Ok(read_recovery(&directory, "pending-integration.json")?.map(|recovery| recovery.receipt))
    }

    pub fn pending_task_document_only(
        &self,
        identity: &str,
        task_id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<bool, CreationError> {
        let journal = load(data, &self.current(identity, protection)?.root, task_id)?;
        Ok(journal.artifacts.is_empty()
            && journal.media_artifacts.is_empty()
            && journal.pending_sources.iter().all(|source| {
                Path::new(&source.path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| matches!(extension, "md" | "txt"))
            })
            && journal.entries.iter().all(|entry| {
                Path::new(&entry.path)
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| matches!(extension, "md" | "txt"))
            }))
    }

    pub fn restore_pending_integration(
        &mut self,
        identity: &str,
        originals_only: bool,
        data: &Path,
        protection: &Protection,
    ) -> Result<PendingIntegrationReceipt, CreationError> {
        if self.assistant_grant.is_some() {
            return Err(invalid(
                "Stop the current Work task before restoring its integration",
            ));
        }
        self.pending_integration(identity, data, protection)?;
        let directory = self
            .materials_path(data, identity, protection)
            .map_err(failure)?;
        let mut recovery = read_recovery(&directory, "pending-integration.json")?
            .ok_or_else(|| invalid("No completed pending integration is available"))?;
        let mut collection = documents::load(&directory).map_err(failure)?;
        // Validate every original before touching project files or restoring any document.
        for original in &recovery.originals {
            if collection.materials.iter().any(|copy| {
                (copy.material.id == original.material.id
                    && (copy.material.version != original.material.version
                        || copy.material.name != original.material.name))
                    || (copy.material.id != original.material.id
                        && copy
                            .material
                            .name
                            .eq_ignore_ascii_case(&original.material.name))
            }) {
                return Err(CreationError::new(
                    CreationErrorCode::VersionConflict,
                    &original.material.name,
                ));
            }
        }
        documents::update_pending_media_originals(
            &directory,
            &recovery.original_images,
            true,
            false,
        )
        .map_err(failure)?;
        if !originals_only {
            let project = self.current(identity, protection)?;
            let private_data = project
                .root
                .join(crate::creation_data::DIRECTORY)
                .join("pending-recovery");
            let restore_id = prepare_restore(&mut recovery, project, &private_data)?;
            persist(&directory, "pending-integration.json", &recovery)?;
            // The existing whole-task undo validates all targets and durably records each restored file.
            self.undo_assistant_task(identity, &restore_id, None, &private_data, protection)?;
        }
        for original in &recovery.originals {
            if !collection
                .materials
                .iter()
                .any(|copy| copy.material.id == original.material.id)
            {
                collection.materials.push(original.clone());
            }
        }
        documents::publish(&directory, &collection).map_err(failure)?;
        documents::update_pending_media_originals(
            &directory,
            &recovery.original_images,
            true,
            true,
        )
        .map_err(failure)?;
        recovery.receipt.restored = true;
        persist(&directory, "pending-integration.json", &recovery)?;
        Ok(recovery.receipt)
    }
}
