//! Creator decisions are private task facts, independent of the live write grant.
use super::*;
use crate::project::creation::libraries::CreationLibrary;
use crate::project::creation::modules::ModuleState;

pub(super) fn require_exact_library_reference(
    library: &CreationLibrary,
) -> Result<(), CreationError> {
    if let Some(current) = &library.referenced_version {
        let expected = &library.version;
        if current != expected {
            let id = &library.id;
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                format!("manifest.json shared library {id} references {current}; the shipped version is {expected}. Preserve the existing version and resolve this conflict explicitly"),
            ));
        }
    }
    Ok(())
}

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
        self.require_question_answer()?;
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
    fn hub_production_dependency(
        &self,
        identity: &str,
        required_version: &str,
        protection: &Protection,
    ) -> Result<Option<AssistantWrite>, CreationError> {
        let (text, version) = match self.read(identity, "package.json", protection) {
            Ok(content) => {
                let (text, version) = text_content(content)?;
                (text, Some(version))
            }
            Err(cause) if cause.code == CreationErrorCode::Missing => ("{}".into(), None),
            Err(cause) => return Err(cause),
        };
        let mut package: serde_json::Value =
            serde_json::from_str(&text).map_err(|cause| invalid(cause.to_string()))?;
        let object = package
            .as_object_mut()
            .ok_or_else(|| invalid("package.json must contain an object"))?;
        for section in ["dependencies", "optionalDependencies", "devDependencies"] {
            if let Some(dependencies) = object.get(section) {
                let dependencies = dependencies
                    .as_object()
                    .ok_or_else(|| invalid(format!("package.json {section} must be an object")))?;
                if let Some(declared) = dependencies.get("socket.io-client") {
                    if declared.as_str() != Some(required_version) {
                        return Err(CreationError::new(
                            CreationErrorCode::VersionConflict,
                            format!("package.json {section} socket.io-client declares {declared}; hub requires exact {required_version}. Preserve the existing version and resolve this conflict explicitly"),
                        ));
                    }
                }
            }
        }
        if object
            .get("dependencies")
            .and_then(|dependencies| dependencies.get("socket.io-client"))
            .and_then(serde_json::Value::as_str)
            == Some(required_version)
        {
            return Ok(None);
        }
        object
            .entry("dependencies")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .expect("validated dependencies")
            .insert(
                "socket.io-client".into(),
                serde_json::json!(required_version),
            );
        Ok(Some(AssistantWrite {
            path: "package.json".into(),
            version,
            text: Some(
                serde_json::to_string_pretty(&package)
                    .map_err(|cause| invalid(cause.to_string()))?
                    + "\n",
            ),
            edits: None,
        }))
    }

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
        journal.require_question_answer()?;
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
        let mut library_ids = request.libraries.clone();
        let includes_camera = request
            .modules
            .iter()
            .any(|module| module == "camera-handpose");
        if includes_camera {
            self.validate_camera_module_resources(identity, resources, protection)?;
            library_ids.push("ml5".into());
        }
        let includes_hub = request.modules.iter().any(|module| module == "hub");
        if includes_hub {
            library_ids.push("socket.io-client".into());
        }
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
        if !library_ids.is_empty() {
            let libraries = self.library_catalog(identity, resources, protection)?;
            for id in &library_ids {
                let entry = libraries
                    .libraries
                    .iter()
                    .find(|entry| &entry.id == id)
                    .ok_or_else(|| invalid("Unknown offline shared library"))?;
                require_exact_library_reference(entry)?;
                if includes_hub && id == "socket.io-client" {
                    let _ = self.hub_production_dependency(identity, &entry.version, protection)?;
                }
                if entry.referenced_version.as_ref() == Some(&entry.version) {
                    continue;
                }
                let resource = AssistantResource {
                    kind: AssistantResourceKind::Library,
                    id: id.clone(),
                    version: entry.version.clone(),
                    source: serde_json::to_string(&entry.source).expect("source"),
                };
                if matches!(id.as_str(), "socket.io-client" | "qrcode")
                    && !(includes_hub && id == "socket.io-client")
                    && !journal.approved(&resource)
                {
                    return Err(invalid(format!("{id} is not an independently selectable new resource. Select hub to include its managed Node client; QR encoding is provided by the App")));
                }
                selected.push(resource);
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
        resources: &Path,
        protection: &Protection,
    ) -> Result<AssistantTask, CreationError> {
        self.authorize_assistant_task(identity, id, true, protection)?;
        let mut journal = load(data, &self.current(identity, protection)?.root, id)?;
        journal.require_resource_decision()?;
        if module == "camera-handpose" {
            self.validate_camera_module_resources(identity, resources, protection)?;
        }
        let catalog = self.module_catalog(identity, protection)?;
        let entry = catalog
            .modules
            .iter()
            .find(|entry| entry.id == module)
            .ok_or_else(|| invalid("Unknown offline module"))?;
        if entry.state == ModuleState::Conflict {
            return Err(entry.error.clone().expect("conflict error"));
        }
        let resource = AssistantResource {
            kind: AssistantResourceKind::Module,
            id: module.into(),
            version: entry.version.clone(),
            source: serde_json::to_string(&entry.source).expect("source"),
        };
        if entry.state == ModuleState::Available && !journal.approved(&resource) {
            return Err(invalid(
                "Creator confirmation is required before adding this module",
            ));
        }
        let assets = if entry.state == ModuleState::Available {
            modules::assistant_module_assets(module)?
        } else {
            Vec::new()
        };
        if journal.entries.len() + journal.artifacts.len() + assets.len() > 64 {
            return Err(invalid("Task recovery supports 64 files"));
        }
        let camera_manifest_owned_before = journal
            .entries
            .iter()
            .any(|entry| entry.path == "manifest.json");
        let camera_manifest_before = if module == "camera-handpose" && !assets.is_empty() {
            Some(text_content(self.read(identity, "manifest.json", protection)?)?.0)
        } else {
            None
        };
        if module == "camera-handpose" {
            // Validate before the first mutation; the task already owns the combined approval.
            let libraries = self.library_catalog(identity, resources, protection)?;
            let ml5 = libraries
                .libraries
                .iter()
                .find(|library| library.id == "ml5")
                .ok_or_else(|| invalid("The required exact ml5 is not shipped locally"))?;
            require_exact_library_reference(ml5)?;
            let additional = usize::from(
                ml5.referenced_version.is_none()
                    && !journal
                        .entries
                        .iter()
                        .any(|entry| entry.path == "manifest.json"),
            );
            if journal.entries.len() + journal.artifacts.len() + assets.len() + additional > 64 {
                return Err(invalid("Task recovery supports 64 files"));
            }
            if assets
                .iter()
                .any(|(path, _)| journal.entries.iter().any(|entry| &entry.path == path))
            {
                return Err(invalid("Module paths already belong to this task"));
            }
            self.adopt_assistant_library(identity, id, "ml5", data, resources, protection)?;
            journal = load(data, &self.current(identity, protection)?.root, id)?;
        }
        if module == "hub" {
            let libraries = self.library_catalog(identity, resources, protection)?;
            let client = libraries
                .libraries
                .iter()
                .find(|library| library.id == "socket.io-client")
                .ok_or_else(|| invalid("The required socket.io-client is not shipped locally"))?;
            require_exact_library_reference(client)?;
            let production =
                self.hub_production_dependency(identity, &client.version, protection)?;
            let additional = usize::from(
                client.referenced_version.is_none()
                    && !journal
                        .entries
                        .iter()
                        .any(|entry| entry.path == "manifest.json"),
            ) + usize::from(
                production.is_some()
                    && !journal
                        .entries
                        .iter()
                        .any(|entry| entry.path == "package.json"),
            );
            if journal.entries.len() + journal.artifacts.len() + assets.len() + additional > 64 {
                return Err(invalid("Task recovery supports 64 files"));
            }
            self.adopt_assistant_library(
                identity,
                id,
                "socket.io-client",
                data,
                resources,
                protection,
            )?;
            if let Some(write) = production {
                self.write_assistant_file(identity, id, &write, data, protection)?;
            }
            journal = load(data, &self.current(identity, protection)?.root, id)?;
        }
        if assets.is_empty() {
            return Ok(journal.summary());
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
        let publication = (|| {
            // Pending and committed entries serialize differently. Validate the
            // exact final shape in memory before either publication or a false
            // committed recovery record; the durable journal still stays pending.
            let mut committed =
                serde_json::to_value(&journal).map_err(|cause| invalid(cause.to_string()))?;
            let entries = committed["entries"]
                .as_array_mut()
                .expect("journal entries");
            for entry in &mut entries[start..] {
                entry["after"] = entry["pending"].take();
            }
            if serde_json::to_vec(&committed)
                .map_err(|cause| invalid(cause.to_string()))?
                .len()
                > 16 * 1024 * 1024
            {
                return Err(invalid("Task recovery record is full"));
            }
            journal.persist(data)?;
            self.publish_assistant_module(identity, module, protection)
        })();
        if let Err(cause) = publication {
            journal.entries.truncate(start);
            journal.persist(data)?;
            if let Some(text) = camera_manifest_before {
                let (_, version) =
                    text_content(self.read(identity, "manifest.json", protection)?)?;
                self.write_assistant_file(
                    identity,
                    id,
                    &AssistantWrite {
                        path: "manifest.json".into(),
                        version: Some(version),
                        text: Some(text),
                        edits: None,
                    },
                    data,
                    protection,
                )?;
                // Only discard the companion entry created by this failed adoption.
                // A manifest already edited by the author in this task remains owned.
                if !camera_manifest_owned_before {
                    let mut restored = load(data, &self.current(identity, protection)?.root, id)?;
                    restored
                        .entries
                        .retain(|entry| entry.path != "manifest.json");
                    restored.persist(data)?;
                }
            }
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

#[cfg(test)]
mod camera_tests;
