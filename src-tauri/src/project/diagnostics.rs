//! Read-only static project diagnostics shared by App and CLI.
//!
//! No runtime state, process cleanup, code execution, networking or writes occur here.
use super::contained_read::ReadRoot;
use super::manifest::{self, Manifest, SharedLibraryReference};
use super::shared_libraries::LibraryCatalog;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::HashSet;
use std::fs::{File, Metadata};
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::OnceLock;

const TEXT_LIMIT: u64 = 1024 * 1024;
const RESOURCE_LIMIT: u64 = 64 * 1024 * 1024;
const TOTAL_RESOURCE_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticProject {
    pub id: String,
    pub name: String,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticInput {
    pub path: String,
    pub kind: String,
    pub fingerprint: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticStatus {
    Passed,
    Failed,
    Skipped,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub code: String,
    pub status: DiagnosticStatus,
    pub reason: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticIssue {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub field: Option<String>,
    pub path: Option<String>,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub schema_version: u32,
    pub checker_version: String,
    pub project_path: String,
    pub project: Option<DiagnosticProject>,
    pub input_fingerprint: String,
    pub inputs: Vec<DiagnosticInput>,
    pub checks: Vec<DiagnosticCheck>,
    pub issues: Vec<DiagnosticIssue>,
    pub unverified: Vec<String>,
    pub static_passed: bool,
}

impl DiagnosticReport {
    fn check(&mut self, code: &str, status: DiagnosticStatus, reason: impl Into<String>) {
        self.checks.push(DiagnosticCheck {
            code: code.into(),
            status,
            reason: reason.into(),
        });
    }
    fn failure(&mut self, code: &str, field: Option<&str>, path: Option<&str>, reason: String) {
        self.check(code, DiagnosticStatus::Failed, reason.clone());
        self.issues.push(DiagnosticIssue {
            code: code.into(),
            severity: DiagnosticSeverity::Error,
            field: field.map(str::to_owned),
            path: path.map(str::to_owned),
            reason,
        });
    }
    fn observe(&mut self, path: &str, kind: &str, fingerprint: String) {
        self.inputs.push(DiagnosticInput {
            path: path.into(),
            kind: kind.into(),
            fingerprint,
        });
    }
    fn finish(mut self) -> Self {
        self.static_passed = self
            .issues
            .iter()
            .all(|issue| issue.severity != DiagnosticSeverity::Error)
            && self
                .checks
                .iter()
                .all(|check| check.status == DiagnosticStatus::Passed);
        let bytes = serde_json::to_vec(&(
            &self.checker_version,
            &self.project_path,
            &self.inputs,
            &self.checks,
        ))
        .expect("serializable observed inputs");
        self.input_fingerprint = format!("{:x}", Sha256::digest(bytes));
        self
    }
}

impl ReadRoot {
    fn observe(
        &self,
        report: &mut DiagnosticReport,
        path: &str,
        field: &str,
    ) -> Result<File, String> {
        match self.open(path, field) {
            Ok(file) => {
                let metadata = file.metadata().map_err(|error| error.to_string())?;
                report.observe(
                    path,
                    if metadata.is_dir() {
                        "directory"
                    } else {
                        "file"
                    },
                    stamp(&metadata),
                );
                Ok(file)
            }
            Err(error) => {
                report.observe(path, "unavailable", error.clone());
                Err(error)
            }
        }
    }
    fn text(
        &self,
        report: &mut DiagnosticReport,
        path: &str,
        limit: u64,
    ) -> Result<String, String> {
        let mut file = self.observe(report, path, path)?;
        let before = file.metadata().map_err(|error| error.to_string())?;
        if !before.is_file() {
            return Err(format!("{path} is not a regular file"));
        }
        if before.len() > limit {
            return Err(format!("{path} exceeds the {limit}-byte static read limit"));
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("{path} is unreadable: {error}"))?;
        if bytes.len() as u64 > limit {
            return Err(format!("{path} exceeds the {limit}-byte static read limit"));
        }
        if stamp(&before) != stamp(&file.metadata().map_err(|error| error.to_string())?) {
            return Err(format!(
                "{path} changed while it was being read; check again"
            ));
        }
        report.observe(path, "content", format!("{:x}", Sha256::digest(&bytes)));
        String::from_utf8(bytes).map_err(|error| format!("{path} is not UTF-8: {error}"))
    }
}
fn stamp(metadata: &Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec()
    )
}

/// The static report is returned even when a project is unfinished or unreadable.
/// `shared_root` is an App resource/embedding seam, never a project search path.
/// Absence selects installed App resources; no resources are fetched or installed.
pub fn diagnose_project(root: &Path, shared_root: Option<&Path>) -> DiagnosticReport {
    let mut report = DiagnosticReport {
        schema_version: 1,
        checker_version: env!("CARGO_PKG_VERSION").into(),
        project_path: root
            .canonicalize()
            .unwrap_or_else(|_| root.to_path_buf())
            .to_string_lossy()
            .into_owned(),
        project: None,
        input_fingerprint: String::new(),
        inputs: vec![],
        checks: vec![],
        issues: vec![],
        unverified: [
            "runtime",
            "ports",
            "health",
            "sound",
            "artisticQuality",
            "sourceWiring",
            "dependencyExecution",
        ]
        .map(str::to_owned)
        .to_vec(),
        static_passed: false,
    };
    let root = match ReadRoot::new(root) {
        Ok(root) => root,
        Err(error) => {
            report.observe(".", "unavailable", error.clone());
            report.failure("project", None, Some("."), error);
            for code in [
                "manifest",
                "paths",
                "dependencies",
                "sharedLibraries",
                "packaging",
            ] {
                report.check(
                    code,
                    DiagnosticStatus::Skipped,
                    "Project directory is unavailable",
                );
            }
            return report.finish();
        }
    };
    let held_root = root.directory.metadata().ok();
    if let Some(metadata) = held_root.as_ref() {
        report.observe(".", "directory", stamp(metadata));
    }
    let raw = root.text(&mut report, "manifest.json", TEXT_LIMIT);
    let parsed = raw
        .as_ref()
        .map_err(Clone::clone)
        .and_then(|raw| manifest::parse_manifest(raw));
    let manifest = match parsed {
        Ok(manifest) => {
            report.project = Some(DiagnosticProject {
                id: manifest.id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
            });
            report.check(
                "manifest",
                DiagnosticStatus::Passed,
                "Saved manifest schema is valid",
            );
            check_paths(&root, &manifest, &mut report);
            Some(manifest)
        }
        Err(error) => {
            report.failure("manifest", Some("manifest"), Some("manifest.json"), error);
            report.check(
                "paths",
                DiagnosticStatus::Skipped,
                "A valid manifest is required to interpret declared paths",
            );
            None
        }
    };
    let unknown_references = manifest.is_none()
        && raw
            .as_ref()
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .is_none_or(|value| value.get("sharedLibraries").is_some());
    check_dependencies(
        &root,
        manifest
            .as_ref()
            .map(|manifest| manifest.shared_libraries.as_slice())
            .unwrap_or(&[]),
        unknown_references,
        &mut report,
    );
    if let Some(manifest) = manifest.as_ref() {
        check_shared(&manifest.shared_libraries, shared_root, &mut report);
        if let Err(error) = super::bundle::bundle_output_path(&root.path, manifest) {
            report.failure("packaging", None, Some("manifest.json"), error);
        }
        let valid = report.issues.is_empty()
            && report
                .checks
                .iter()
                .all(|check| check.status == DiagnosticStatus::Passed);
        report.check("packaging", if valid { DiagnosticStatus::Passed } else { DiagnosticStatus::Failed },
            if valid { "Declared paths, artifacts, dependencies and shared requirements satisfy static bundle prerequisites; no bundle was generated" }
            else { "Static bundle prerequisites are blocked by the reported issues" });
    } else {
        report.check(
            "sharedLibraries",
            DiagnosticStatus::Skipped,
            "A valid manifest is required to verify exact shared references",
        );
        report.check(
            "packaging",
            DiagnosticStatus::Skipped,
            "A valid manifest is required for bundle prerequisites",
        );
    }
    if let Err(error) = root.check_current() {
        report.failure("project", None, Some("."), error);
    }
    report.finish()
}

fn check_paths(root: &ReadRoot, manifest: &Manifest, report: &mut DiagnosticReport) {
    for (code, field, path, directory) in [
        (
            "entry",
            "scoreServer.entry",
            manifest.score_server.entry.as_str(),
            false,
        ),
        (
            "workingDirectory",
            "scoreServer.workingDirectory",
            manifest.score_server.working_directory.as_str(),
            true,
        ),
    ] {
        check_path(root, report, code, field, path, directory);
    }
    for (index, path) in manifest
        .audio
        .synthdefs
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .enumerate()
    {
        check_path(
            root,
            report,
            "synthdef",
            &format!("audio.synthdefs[{index}]"),
            path,
            false,
        );
    }
}
fn check_path(
    root: &ReadRoot,
    report: &mut DiagnosticReport,
    code: &str,
    field: &str,
    path: &str,
    directory: bool,
) {
    let outcome = root.observe(report, path, field).and_then(|file| {
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if (directory && metadata.is_dir()) || (!directory && metadata.is_file()) {
            Ok(())
        } else {
            Err(format!(
                "{field} must be a {}: {path}",
                if directory { "directory" } else { "file" }
            ))
        }
    });
    match outcome {
        Ok(()) => report.check(
            code,
            DiagnosticStatus::Passed,
            format!("{field}: {path} is present and contained"),
        ),
        Err(error) => report.failure(code, Some(field), Some(path), error),
    }
}
fn check_dependencies(
    root: &ReadRoot,
    references: &[SharedLibraryReference],
    unknown_references: bool,
    report: &mut DiagnosticReport,
) {
    // Absent package.json is valid; broken links, directories and unreadable files
    // are observations requiring an explanation, rather than inferred absence.
    if std::fs::symlink_metadata(root.path.join("package.json"))
        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
    {
        report.observe("package.json", "missing", "missing".into());
        report.check(
            "dependencies",
            DiagnosticStatus::Passed,
            "No package.json production dependencies are declared",
        );
        return;
    }
    let package = root
        .text(report, "package.json", TEXT_LIMIT)
        .and_then(|body| {
            serde_json::from_str::<serde_json::Value>(&body)
                .map_err(|error| format!("package.json is not valid JSON: {error}"))
        });
    let package = match package {
        Ok(package) => package,
        Err(error) => {
            report.failure("dependencies", None, Some("package.json"), error);
            return;
        }
    };
    if unknown_references {
        report.check("dependencies", DiagnosticStatus::Skipped, "Invalid shared declarations prevent determining which production dependencies must be local");
        return;
    }
    let node_modules = root.observe(report, "node_modules", "node_modules");
    let available = node_modules
        .as_ref()
        .is_ok_and(|file| file.metadata().is_ok_and(|metadata| metadata.is_dir()));
    let outcome = super::preflight::check_dependency_value(
        &package,
        references,
        available,
        &root.path.join("node_modules"),
    );
    match outcome {
        Ok(()) => report.check("dependencies", DiagnosticStatus::Passed, "Production declarations satisfy the local directory / exact shared reference contract; package execution is unverified"),
        Err(mut error) => {
            if let Err(cause) = node_modules {
                error.push_str(&format!("\n{cause}"));
            }
            report.failure("dependencies", None, Some("package.json"), error);
        }
    }
}
fn check_shared(
    references: &[SharedLibraryReference],
    supplied_root: Option<&Path>,
    report: &mut DiagnosticReport,
) {
    if references.is_empty() {
        report.check(
            "sharedLibraries",
            DiagnosticStatus::Passed,
            "No App shared libraries are declared",
        );
        return;
    }
    let default;
    let resource_path = match supplied_root {
        Some(root) => root,
        None => match super::shared_libraries::default_root() {
            Ok(root) => {
                default = root;
                &default
            }
            Err(error) => {
                report.observe("app:shared-libraries", "unavailable", error.clone());
                report.failure(
                    "sharedLibraries",
                    Some("sharedLibraries"),
                    None,
                    super::shared_libraries::required_error(references, error),
                );
                return;
            }
        },
    };
    let resource_root = match ReadRoot::new(resource_path) {
        Ok(root) => root,
        Err(error) => {
            report.observe("app:shared-libraries", "unavailable", error.clone());
            report.failure(
                "sharedLibraries",
                Some("sharedLibraries"),
                None,
                super::shared_libraries::required_error(references, error),
            );
            return;
        }
    };
    let mut resource_report = report.clone();
    resource_report.inputs.clear();
    if let Ok(metadata) = resource_root.directory.metadata() {
        resource_report.observe(".", "directory", stamp(&metadata));
    }
    let catalog_stamp = resource_root
        .open("catalog.json", "sharedLibraries")
        .and_then(|file| file.metadata().map_err(|error| error.to_string()));
    let catalog = resource_root
        .text(&mut resource_report, "catalog.json", 32 * TEXT_LIMIT)
        .and_then(|_| LibraryCatalog::load_with_reader(&resource_root));
    let mut budget = 0u64;
    let mut observed = HashSet::new();
    static RESOLVER: OnceLock<super::shared_libraries::SharedLibraryResolver> = OnceLock::new();
    let resolver = RESOLVER.get_or_init(super::shared_libraries::SharedLibraryResolver::default);
    match catalog {
        Ok(catalog) => {
            for reference in references {
                let mut bounded = if budget > TOTAL_RESOURCE_LIMIT {
                    Err("Shared resource inventory exceeds the 512 MiB/report static inspection limit".to_string())
                } else {
                    Ok(())
                };
                if let Some(library) = catalog.libraries.iter().find(|library| {
                    library.id == reference.id && library.version == reference.version
                }) {
                    for resource in &library.files {
                        if resource.bytes > RESOURCE_LIMIT || budget > TOTAL_RESOURCE_LIMIT {
                            bounded = Err("Shared resource inventory exceeds static inspection limits (64 MiB/file, 512 MiB/report)".to_string());
                            break;
                        }
                        if !observed.insert(resource.path.clone()) {
                            continue;
                        }
                        let file = resource_root.observe(
                            &mut resource_report,
                            &resource.path,
                            "sharedLibraries",
                        );
                        match file
                            .and_then(|file| file.metadata().map_err(|error| error.to_string()))
                        {
                            Ok(metadata) => {
                                budget = budget.saturating_add(metadata.len().max(resource.bytes));
                                if metadata.len() > RESOURCE_LIMIT || budget > TOTAL_RESOURCE_LIMIT
                                {
                                    bounded = Err("Shared resource inventory exceeds static inspection limits (64 MiB/file, 512 MiB/report)".to_string());
                                    break;
                                }
                            }
                            Err(error) => {
                                bounded = Err(error);
                                break;
                            }
                        }
                    }
                }
                let label = format!("{} {}", reference.id, reference.version);
                let outcome = bounded.and_then(|_| {
                    catalog_stamp
                        .as_ref()
                        .map_err(Clone::clone)
                        .and_then(|stamp| {
                            resolver.resolve_observed_at(
                                &resource_root,
                                std::slice::from_ref(reference),
                                stamp,
                            )
                        })
                });
                match outcome {
                    Ok(_) => report.check("sharedLibraries", DiagnosticStatus::Passed, format!("Required App library {label} passed exact version and resource integrity checks")),
                    Err(error) => report.failure("sharedLibraries", Some("sharedLibraries"), None, format!("Required App library {label}: {error}")),
                }
            }
        }
        Err(error) => report.failure(
            "sharedLibraries",
            Some("sharedLibraries"),
            None,
            super::shared_libraries::required_error(references, error),
        ),
    }
    if let Err(error) = resource_root.check_current() {
        report.failure(
            "sharedLibraries",
            Some("sharedLibraries"),
            Some("app:shared-libraries"),
            error,
        );
    } else if let Some(input) = resource_report
        .inputs
        .iter()
        .find(|input| input.path == "catalog.json" && input.kind == "file")
    {
        let unchanged = resource_root
            .open("catalog.json", "sharedLibraries")
            .and_then(|file| file.metadata().map_err(|error| error.to_string()))
            .is_ok_and(|metadata| stamp(&metadata) == input.fingerprint);
        if !unchanged {
            report.failure(
                "sharedLibraries",
                Some("sharedLibraries"),
                Some("app:shared-libraries/catalog.json"),
                "App shared library catalog changed during inspection; check again".into(),
            );
        }
    }
    for mut input in resource_report.inputs {
        input.path = format!("app:shared-libraries/{}", input.path);
        report.inputs.push(input);
    }
}

#[cfg(test)]
mod tests;
