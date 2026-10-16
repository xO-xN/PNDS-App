//! Declarative literal bindings. No evaluator, process or filesystem writer.
use super::*;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

pub const PREVIEW_CONTRACT: &str = "pnds.preview.json";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAuthorization {
    pub runtime: crate::project::session::CreationRuntime,
    pub source_digest: String,
    pub contract_digest: String,
}

pub fn preview_digest(text: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("sha256:{:x}", Sha256::digest(text.as_bytes()))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ParameterKind {
    Number,
    Boolean,
    Text,
    Color,
    Option,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterLimits {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    #[serde(default)]
    pub options: Vec<String>,
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ParameterPreview {
    Live,
    Refresh,
    Restart,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterSpec {
    pub id: String,
    pub path: String,
    /// Exact prefix/suffix of one whole line, excluding its line ending.
    pub prefix: String,
    pub suffix: String,
    pub kind: ParameterKind,
    pub limits: ParameterLimits,
    pub preview: ParameterPreview,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterRequest {
    pub spec: ParameterSpec,
    pub current: Value,
    pub suggested_min: Option<f64>,
    pub suggested_max: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoundParameter {
    pub request: ParameterRequest,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ParameterCandidate {
    pub parameters: Vec<BoundParameter>,
    pub contract_version: Option<String>,
    /// Changes outside successfully mapped literals have not been previewed.
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterContract {
    pub schema_version: u32,
    pub parameters: Vec<ParameterSpec>,
}

fn invalid(detail: &str) -> CreationError {
    CreationError::new(CreationErrorCode::InvalidProject, detail)
}

pub fn parameter_value_valid(spec: &ParameterSpec, value: &Value) -> bool {
    let limits = &spec.limits;
    match spec.kind {
        ParameterKind::Number => value.as_f64().is_some_and(|number| {
            number.is_finite()
                && limits.min.is_none_or(|min| number >= min)
                && limits.max.is_none_or(|max| number <= max)
                && limits.step.is_none_or(|step| {
                    let count = (number - limits.min.unwrap_or(0.0)) / step;
                    (count - count.round()).abs() < 1e-7
                })
        }),
        ParameterKind::Boolean => value.is_boolean(),
        ParameterKind::Text | ParameterKind::Color | ParameterKind::Option => {
            value.as_str().is_some_and(|text| {
                text.len() <= 4096
                    && limits
                        .max_length
                        .is_none_or(|max| text.chars().count() <= max as usize)
                    && (spec.kind != ParameterKind::Option
                        || limits.options.iter().any(|item| item == text))
                    && (spec.kind != ParameterKind::Color
                        || (text.len() == 7
                            && text.starts_with('#')
                            && text[1..].bytes().all(|byte| byte.is_ascii_hexdigit())))
            })
        }
    }
}

/// Returns the sole complete-line literal. Expressions and duplicate anchors
/// deliberately have no binding, even when they happen to produce a number.
fn locate(text: &str, spec: &ParameterSpec) -> Option<(usize, usize, Value)> {
    let mut offset = 0;
    let mut found = None;
    for line in text.split_inclusive('\n') {
        let body = line.trim_end_matches(['\r', '\n']);
        if let Some(literal) = body
            .strip_prefix(&spec.prefix)
            .and_then(|rest| rest.strip_suffix(&spec.suffix))
        {
            if found.is_some() {
                return None;
            }
            let value: Value = serde_json::from_str(literal).ok()?;
            if !parameter_value_valid(spec, &value) {
                return None;
            }
            let start = offset + spec.prefix.len();
            found = Some((start, start + literal.len(), value));
        }
        offset += line.len();
    }
    found
}

fn validate_spec(spec: &ParameterSpec) -> Result<(), CreationError> {
    let limits = &spec.limits;
    if spec.id.is_empty()
        || spec.id.len() > 80
        || !spec
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || spec.prefix.is_empty()
        || spec.suffix.is_empty()
        || spec.prefix.len() + spec.suffix.len() > 4096
        || spec.prefix.contains(['\r', '\n'])
        || spec.suffix.contains(['\r', '\n'])
        || limits.min.is_some_and(|n| !n.is_finite())
        || limits.max.is_some_and(|n| !n.is_finite())
        || limits.step.is_some_and(|n| !n.is_finite() || n <= 0.0)
        || limits
            .min
            .zip(limits.max)
            .is_some_and(|(min, max)| min > max)
        || limits.options.len() > 64
        || limits.options.iter().any(|s| s.len() > 4096)
        || (spec.kind == ParameterKind::Option && limits.options.is_empty())
        || (spec.kind != ParameterKind::Number
            && (limits.min.is_some() || limits.max.is_some() || limits.step.is_some()))
        || (spec.kind != ParameterKind::Option && !limits.options.is_empty())
        || (matches!(spec.kind, ParameterKind::Number | ParameterKind::Boolean)
            && limits.max_length.is_some())
    {
        return Err(invalid("Invalid parameter declaration"));
    }
    Ok(())
}

impl CreationAccess {
    pub fn parameter_contract(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<Option<(ParameterContract, String)>, CreationError> {
        let content = match self.read(identity, PREVIEW_CONTRACT, protection) {
            Ok(content) => content,
            Err(error) if error.code == CreationErrorCode::Missing => return Ok(None),
            Err(error) => return Err(error),
        };
        let CreationContent::Text { text, version } = content else {
            return Err(invalid("Invalid preview declaration"));
        };
        let contract: ParameterContract =
            serde_json::from_str(&text).map_err(|_| invalid("Incompatible preview declaration"))?;
        if contract.schema_version != 1 || contract.parameters.len() > 32 {
            return Err(invalid("Incompatible preview declaration"));
        }
        let mut ids = HashSet::new();
        let mut anchors = HashSet::new();
        for spec in &contract.parameters {
            validate_spec(spec)?;
            if !ids.insert(&spec.id) || !anchors.insert((&spec.path, &spec.prefix, &spec.suffix)) {
                return Err(invalid("Duplicate parameter declaration"));
            }
            // Opening through CreationAccess also rejects escaping/protected paths.
            if !matches!(
                self.read(identity, &spec.path, protection)?,
                CreationContent::Text { .. }
            ) {
                return Err(invalid("Parameter requires an existing text file"));
            }
        }
        Ok(Some((contract, version)))
    }

    pub fn authorize_parameter_preview(
        &self,
        identity: &str,
        path: &str,
        version: &str,
        contract_version: &str,
        runtime: crate::project::session::CreationRuntime,
        protection: &Protection,
    ) -> Result<PreviewAuthorization, CreationError> {
        let project = self.descriptor(identity, protection)?;
        let CreationContent::Text {
            text: source,
            version: actual,
        } = self.read(identity, path, protection)?
        else {
            return Err(invalid("Preview requires text"));
        };
        let contract = self.parameter_contract(identity, protection)?;
        if actual != version || contract.is_none_or(|(_, actual)| actual != contract_version) {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Preview source changed",
            ));
        }
        if runtime.project_root.as_deref() != Some(&project.root)
            || runtime.snapshot.status != crate::types::SessionStatus::Ready
        {
            return Err(CreationError::new(
                CreationErrorCode::TestValidation,
                "Manually start the same project before previewing",
            ));
        }
        let CreationContent::Text {
            text: contract,
            version: actual,
        } = self.read(identity, PREVIEW_CONTRACT, protection)?
        else {
            return Err(invalid("Preview requires a declaration"));
        };
        if actual != contract_version {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "Preview declaration changed",
            ));
        }
        Ok(PreviewAuthorization {
            runtime,
            source_digest: preview_digest(&source),
            contract_digest: preview_digest(&contract),
        })
    }

    pub fn bind_parameters(
        &self,
        identity: &str,
        path: &str,
        version: &str,
        candidate: &str,
        requests: &[ParameterRequest],
        protection: &Protection,
    ) -> Result<ParameterCandidate, CreationError> {
        if candidate.len() as u64 > TEXT_MAX_BYTES || requests.len() > 16 {
            return Err(invalid("Parameter candidate exceeds limits"));
        }
        let CreationContent::Text {
            text: source,
            version: actual,
        } = self.read(identity, path, protection)?
        else {
            return Err(invalid("Parameter requires text"));
        };
        if actual != version {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
        }
        let contract = self.parameter_contract(identity, protection)?;
        let mut ids = HashSet::new();
        let mut source_ranges = Vec::new();
        let mut replacements = Vec::new();
        let mut parameters = Vec::new();
        for request in requests {
            let spec = &request.spec;
            validate_spec(spec)?;
            if spec.path != path || !ids.insert(&spec.id) {
                return Err(invalid("Wrong or duplicate parameter target"));
            }
            let declared = contract.as_ref().and_then(|(c, _)| {
                c.parameters.iter().find(|p| {
                    p.id == spec.id
                        || (p.path == spec.path
                            && p.prefix == spec.prefix
                            && p.suffix == spec.suffix)
                })
            });
            if declared.is_some_and(|declared| declared != spec)
                || (declared.is_none()
                    && (spec.limits != ParameterLimits::default()
                        || spec.preview != ParameterPreview::Unsupported))
            {
                return Err(invalid(
                    "Parameter constraints or capability differ from project declaration",
                ));
            }
            if request
                .suggested_min
                .zip(request.suggested_max)
                .is_some_and(|(min, max)| min > max)
                || [request.suggested_min, request.suggested_max]
                    .iter()
                    .flatten()
                    .any(|n| !n.is_finite())
            {
                return Err(invalid("Invalid suggested range"));
            }
            let (start, end, value) = locate(&source, spec).ok_or_else(|| {
                invalid("Source parameter is ambiguous or not a supported literal")
            })?;
            let same_value = if spec.kind == ParameterKind::Number {
                value.as_f64() == request.current.as_f64()
            } else {
                value == request.current
            };
            if !same_value || source_ranges.iter().any(|(a, b)| start < *b && end > *a) {
                return Err(invalid(
                    "Parameter current value or location differs from source",
                ));
            }
            source_ranges.push((start, end));
            let source_literal = source[start..end].to_owned();
            if let Some((start, end, _)) = locate(candidate, spec) {
                if replacements.iter().any(|(a, b, _)| start < *b && end > *a) {
                    return Err(invalid("Overlapping candidate parameters"));
                }
            }
            let value = locate(candidate, spec).map(|(start, end, value)| {
                replacements.push((start, end, source_literal));
                value
            });
            parameters.push(BoundParameter {
                request: request.clone(),
                value,
            });
        }
        replacements.sort_by_key(|(start, _, _)| *start);
        let mut normalized = candidate.to_owned();
        for (start, end, literal) in replacements.into_iter().rev() {
            normalized.replace_range(start..end, &literal);
        }
        Ok(ParameterCandidate {
            parameters,
            contract_version: contract.map(|(_, v)| v),
            partial: normalized != source,
        })
    }
}
