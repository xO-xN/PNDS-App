//! Creator decisions are private task facts, independent of the live write grant.
use super::*;
use crate::project::creation::modules::ModuleState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantResourceKind {
    Module,
    Library,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResource {
    pub kind: AssistantResourceKind,
    pub id: String,
    pub version: String,
    /// Exact shipped provenance, not a model-supplied source.
    pub source: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantResourceDecision {
    Pending,
    Approved,
    Alternative,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResourcePlan {
    pub id: String,
    pub resources: Vec<AssistantResource>,
    pub reason: String,
    pub alternative: Option<String>,
    pub decision: AssistantResourceDecision,
}
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantResourceRequest {
    pub modules: Vec<String>,
    pub libraries: Vec<String>,
    pub reason: String,
    pub alternative: Option<String>,
}

impl Journal {
    pub(super) fn require_resource_decision(&self) -> Result<(), CreationError> {
        if self
            .resource_plans
            .iter()
            .any(|plan| plan.decision == AssistantResourceDecision::Pending)
        {
            return Err(invalid(
                "Wait for the creator's local-resource decision before modifying the project",
            ));
        }
        Ok(())
    }
    pub(super) fn approved(&self, resource: &AssistantResource) -> bool {
        self.resource_plans.iter().any(|plan| {
            plan.decision == AssistantResourceDecision::Approved
                && plan.resources.contains(resource)
        })
    }
    pub(super) fn check_resource_write(
        &self,
        path: &str,
        before: Option<&str>,
        after: &str,
        validated_library: bool,
    ) -> Result<(), CreationError> {
        if is_root_manifest(path) || path.eq_ignore_ascii_case("manifest.json") {
            let old: serde_json::Value = serde_json::from_str(before.unwrap_or("{}"))
                .map_err(|cause| invalid(cause.to_string()))?;
            let new: serde_json::Value =
                serde_json::from_str(after).map_err(|cause| invalid(cause.to_string()))?;
            for reference in new["sharedLibraries"].as_array().into_iter().flatten() {
                let existed = old["sharedLibraries"]
                    .as_array()
                    .is_some_and(|items| items.contains(reference));
                let approved = self.resource_plans.iter().any(|plan| {
                    plan.decision == AssistantResourceDecision::Approved
                        && plan.resources.iter().any(|item| {
                            item.kind == AssistantResourceKind::Library
                                && reference["id"] == item.id
                                && reference["version"] == item.version
                        })
                });
                if !existed && (!approved || !validated_library) {
                    return Err(invalid("New shared libraries require a creator-confirmed plan and catalog validation. Use propose_local_resources, then use_local_library; generic manifest writes cannot add them"));
                }
            }
        }
        if let Some(id) = path
            .strip_prefix("modules/pnds-")
            .and_then(|path| path.split('/').next())
        {
            if before.is_none()
                && modules::assistant_module_assets(id).is_ok()
                && !self.resource_plans.iter().any(|plan| {
                    plan.decision == AssistantResourceDecision::Approved
                        && plan
                            .resources
                            .iter()
                            .any(|item| item.kind == AssistantResourceKind::Module && item.id == id)
                })
            {
                return Err(invalid("New standard modules require a creator-confirmed local-resource plan; use propose_local_resources"));
            }
        }
        Ok(())
    }
}

impl CreationAccess {
    pub fn assistant_resource_plans(
        &self,
        identity: &str,
        id: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<Vec<AssistantResourcePlan>, CreationError> {
        if self.git_ended_tasks.contains(id) {
            return Err(invalid("This task was ended before switching versions"));
        }
        Ok(load(data, &self.current(identity, protection)?.root, id)?.resource_plans)
    }

    pub fn propose_assistant_resources(
        &self,
        identity: &str,
        id: &str,
        request: &AssistantResourceRequest,
        data: &Path,
        resources: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        if journal
            .resource_plans
            .iter()
            .any(|plan| plan.decision == AssistantResourceDecision::Pending)
        {
            return Ok(journal.summary());
        }
        if request.reason.trim().is_empty()
            || request.reason.len() > 4096
            || request
                .alternative
                .as_ref()
                .is_some_and(|text| text.trim().is_empty() || text.len() > 2048)
            || request.modules.len() + request.libraries.len() > 12
            || journal.resource_plans.len() >= 16
        {
            return Err(invalid("Invalid local-resource proposal"));
        }
        let mut selected = Vec::new();
        let modules = self.module_catalog(identity, protection)?;
        for id in &request.modules {
            let entry = modules
                .modules
                .iter()
                .find(|entry| &entry.id == id)
                .ok_or_else(|| invalid("Unknown offline module"))?;
            if entry.state == ModuleState::Conflict {
                return Err(entry.error.clone().expect("conflict error"));
            }
            if entry.state != ModuleState::Available {
                continue;
            }
            selected.push(AssistantResource {
                kind: AssistantResourceKind::Module,
                id: id.clone(),
                version: entry.version.clone(),
                source: serde_json::to_string(&entry.source).expect("source"),
            });
        }
        if !request.libraries.is_empty() {
            let libraries = self.library_catalog(identity, resources, protection)?;
            for id in &request.libraries {
                let entry = libraries
                    .libraries
                    .iter()
                    .find(|entry| &entry.id == id)
                    .ok_or_else(|| invalid("Unknown offline shared library"))?;
                if entry.referenced_version.as_ref() == Some(&entry.version) {
                    continue;
                }
                selected.push(AssistantResource {
                    kind: AssistantResourceKind::Library,
                    id: id.clone(),
                    version: entry.version.clone(),
                    source: serde_json::to_string(&entry.source).expect("source"),
                });
            }
        }
        selected.retain(|item| !journal.approved(item));
        selected.sort_by(|left, right| {
            matches!(left.kind, AssistantResourceKind::Library)
                .cmp(&matches!(right.kind, AssistantResourceKind::Library))
                .then_with(|| left.id.cmp(&right.id))
        });
        selected.dedup();
        if !selected.is_empty() {
            // A declined plan cannot be silently re-proposed by the model.
            if journal.resource_plans.iter().any(|plan| {
                plan.decision == AssistantResourceDecision::Alternative
                    && selected.iter().any(|item| plan.resources.contains(item))
            }) {
                return Err(invalid("The creator selected the stated alternative. Do not re-propose declined resources"));
            }
            journal.resource_plans.push(AssistantResourcePlan {
                id: format!("{id}-resources-{}", journal.resource_plans.len() + 1),
                resources: selected,
                reason: request.reason.clone(),
                alternative: request.alternative.clone(),
                decision: AssistantResourceDecision::Pending,
            });
            journal.persist(data)?;
        }
        Ok(journal.summary())
    }

    pub fn decide_assistant_resources(
        &self,
        identity: &str,
        id: &str,
        plan_id: &str,
        decision: AssistantResourceDecision,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantResourcePlan, CreationError> {
        self.assistant_resource_plans(identity, id, data, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        self.verified_assistant_journal_files(identity, &journal, protection)?;
        let plan = journal
            .resource_plans
            .iter_mut()
            .find(|plan| plan.id == plan_id)
            .ok_or_else(|| invalid("Unknown resource plan"))?;
        if journal.mode != AssistantMode::Edit
            || decision == AssistantResourceDecision::Pending
            || (decision == AssistantResourceDecision::Alternative && plan.alternative.is_none())
            || (plan.decision != AssistantResourceDecision::Pending && plan.decision != decision)
        {
            return Err(invalid("Invalid creator resource decision"));
        }
        plan.decision = decision;
        let result = plan.clone();
        journal.persist(data)?;
        Ok(result)
    }

    pub fn adopt_assistant_module(
        &mut self,
        identity: &str,
        id: &str,
        module: &str,
        data: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        let catalog = self.module_catalog(identity, protection)?;
        let entry = catalog
            .modules
            .iter()
            .find(|entry| entry.id == module)
            .ok_or_else(|| invalid("Unknown offline module"))?;
        if entry.state == ModuleState::Conflict {
            return Err(entry.error.clone().expect("conflict error"));
        }
        if entry.state != ModuleState::Available {
            return Ok(journal.summary());
        }
        let resource = AssistantResource {
            kind: AssistantResourceKind::Module,
            id: module.into(),
            version: entry.version.clone(),
            source: serde_json::to_string(&entry.source).expect("source"),
        };
        if !journal.approved(&resource) {
            return Err(invalid(
                "Creator confirmation is required before adding this module",
            ));
        }
        let assets = modules::assistant_module_assets(module)?;
        if journal.entries.len() + assets.len() > 64 {
            return Err(invalid("Task recovery supports 64 files"));
        }
        let start = journal.entries.len();
        for (path, text) in &assets {
            if journal.entries.iter().any(|entry| &entry.path == path) {
                return Err(invalid("Module paths already belong to this task"));
            }
            journal.entries.push(Entry {
                path: path.clone(),
                before: None,
                after: String::new(),
                pending: Some(text.clone()),
                undone: false,
                removed: false,
                pending_remove: false,
            });
        }
        // Journal all immutable bytes BEFORE exclusive atomic directory publication.
        journal.persist(data)?;
        if let Err(cause) = self.publish_assistant_module(identity, module, protection) {
            journal.entries.truncate(start);
            journal.persist(data)?;
            return Err(cause);
        }
        for entry in &mut journal.entries[start..] {
            entry.after = entry.pending.take().expect("prepared module bytes");
        }
        journal.persist(data)?;
        self.last_change = None;
        Ok(journal.summary())
    }
}

#[cfg(test)]
mod tests;
