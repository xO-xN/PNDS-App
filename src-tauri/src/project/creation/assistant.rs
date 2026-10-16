//! Assistant-only saved text access. Both the entry spelling and canonical
//! target obey the same exclusion policy, including internal symlink aliases.
use super::*;

const FILE_BYTES: u64 = 64 * 1024;
const INVENTORY_BYTES: u64 = 2 * 1024 * 1024;
const READABLE_FILES: usize = 256;

#[derive(Default)]
struct InventoryBudget {
    bytes: u64,
    readable: usize,
    entries: usize,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantProjectFile {
    pub path: String,
    pub bytes: u32,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantProjectSnapshot {
    pub files: Vec<AssistantProjectFile>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantProjectOverview {
    pub snapshot: AssistantProjectSnapshot,
    pub manifest_status: String,
    pub content_paths: Vec<String>,
    pub evidence: Vec<AssistantProjectPage>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantProjectPage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::assistant_history::AssistantAttachmentSource>,
    pub path: String,
    pub version: String,
    pub text: String,
    pub offset: u32,
    pub end_offset: u32,
    pub total_characters: u32,
    pub next_offset: Option<u32>,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssistantProjectRead {
    pub path: String,
    pub version: Option<String>,
    pub offset: u32,
    pub page_length: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantProjectSearch {
    pub pages: Vec<AssistantProjectPage>,
    pub skipped: Vec<AssistantProjectFile>,
    pub searched_files: u32,
    pub remaining_files: u32,
}

pub(super) fn excluded(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    let parts: Vec<_> = lower.split('/').collect();
    if parts.iter().any(|part| {
        matches!(
            *part,
            ".git"
                | "node_modules"
                | "target"
                | "dist"
                | "build"
                | "coverage"
                | ".next"
                | ".cache"
                | "vendor"
                | "third_party"
                | "third-party"
        ) || part.starts_with(".pnds-save-")
    }) {
        return Some("dependencyOrBuild");
    }
    let name = parts.last().copied().unwrap_or("");
    if parts
        .iter()
        .any(|part| matches!(*part, ".ssh" | ".aws" | ".gnupg" | ".secrets"))
        || name == ".env"
        || name.starts_with(".env.")
        || matches!(
            name,
            ".npmrc"
                | ".netrc"
                | ".pypirc"
                | "credentials"
                | "credentials.json"
                | "secrets.json"
                | "secrets.yaml"
                | "secrets.yml"
                | "id_rsa"
                | "id_ed25519"
        )
        || [".pem", ".key", ".p12", ".pfx", ".keystore"]
            .iter()
            .any(|suffix| name.ends_with(suffix))
    {
        return Some("sensitive");
    }
    if name.ends_with(".lock")
        || matches!(
            name,
            "package-lock.json" | "npm-shrinkwrap.json" | "pnpm-lock.yaml" | "yarn.lock"
        )
    {
        return Some("lockfile");
    }
    if name.ends_with(".min.js")
        || name.ends_with(".min.css")
        || name.ends_with(".map")
        || name.ends_with(".bundle.js")
    {
        return Some("thirdParty");
    }
    None
}

impl OpenProject {
    fn assistant_text(&self, path: &str) -> Result<String, CreationError> {
        let resolved = self.resolve(path)?;
        let actual = resolved
            .strip_prefix(&self.root)
            .expect("contained")
            .to_string_lossy();
        if let Some(reason) = excluded(path).or_else(|| excluded(&actual)) {
            return Err(CreationError::new(CreationErrorCode::Permission, reason));
        }
        if file_kind(path) != CreationFileKind::Text || file_kind(&actual) != CreationFileKind::Text
        {
            return Err(CreationError::new(CreationErrorCode::Permission, "binary"));
        }
        let file = self.resolved_file(&resolved, path)?;
        if !file.metadata().map_err(io_error)?.is_file() {
            return Err(CreationError::new(
                CreationErrorCode::Permission,
                "notRegular",
            ));
        }
        let text = String::from_utf8(bounded_read(file, FILE_BYTES)?)
            .map_err(|_| CreationError::new(CreationErrorCode::InvalidUtf8, "invalidUtf8"))?;
        if text.contains('\0') {
            return Err(CreationError::new(CreationErrorCode::Permission, "binary"));
        }
        Ok(text)
    }

    fn assistant_walk(
        &self,
        relative: &Path,
        depth: usize,
        files: &mut Vec<AssistantProjectFile>,
        budget: &mut InventoryBudget,
        ancestors: &mut Vec<PathBuf>,
    ) -> Result<(), CreationError> {
        let path = relative.to_string_lossy();
        let resolved = self.resolve(&path)?;
        let actual = resolved
            .strip_prefix(&self.root)
            .expect("contained")
            .to_string_lossy();
        if let Some(reason) = excluded(&path).or_else(|| excluded(&actual)) {
            return Err(CreationError::new(CreationErrorCode::Permission, reason));
        }
        if depth > MAX_DEPTH || ancestors.contains(&resolved) {
            return Err(CreationError::new(
                CreationErrorCode::PathEscape,
                "depthOrCycle",
            ));
        }
        let parent_depth = ancestors.len();
        let mut names = directory_names(self.resolved_file(&resolved, &path)?)?;
        ancestors.push(resolved);
        names.sort();
        for name in names {
            budget.entries += 1;
            if budget.entries > MAX_ENTRIES {
                return Err(CreationError::new(
                    CreationErrorCode::TooLarge,
                    "inventoryEntries",
                ));
            }
            let child = relative.join(name);
            let path = child
                .to_str()
                .ok_or_else(|| CreationError::new(CreationErrorCode::InvalidUtf8, "fileName"))?;
            let mut entry = AssistantProjectFile {
                path: path.into(),
                bytes: 0,
                version: None,
                reason: None,
            };
            let inspect = || -> Result<Option<String>, CreationError> {
                // Check spelling before following, and actual target before opening.
                if let Some(reason) = excluded(path) {
                    return Err(CreationError::new(CreationErrorCode::Permission, reason));
                }
                let resolved = self.resolve(path)?;
                let actual = resolved
                    .strip_prefix(&self.root)
                    .expect("contained")
                    .to_string_lossy();
                if let Some(reason) = excluded(&actual) {
                    return Err(CreationError::new(CreationErrorCode::Permission, reason));
                }
                if self
                    .resolved_file(&resolved, path)?
                    .metadata()
                    .map_err(io_error)?
                    .is_dir()
                {
                    return Ok(None);
                }
                self.assistant_text(path).map(Some)
            };
            match inspect() {
                Ok(None) => {
                    if let Err(error) =
                        self.assistant_walk(&child, depth + 1, files, budget, ancestors)
                    {
                        if error.code == CreationErrorCode::TooLarge {
                            return Err(error);
                        }
                        ancestors.truncate(parent_depth + 1);
                        entry.reason = Some(format!("{:?}", error.code));
                        files.push(entry);
                    }
                    continue;
                }
                Ok(Some(text)) => {
                    entry.bytes = text.len() as u32;
                    if budget.readable >= READABLE_FILES
                        || budget.bytes + text.len() as u64 > INVENTORY_BYTES
                    {
                        entry.reason = Some("inventoryBudget".into());
                    } else {
                        budget.bytes += text.len() as u64;
                        budget.readable += 1;
                        entry.version = Some(file_version(text.as_bytes()));
                    }
                }
                Err(error) => {
                    entry.reason = Some(match error.code {
                        CreationErrorCode::Permission => error.detail,
                        CreationErrorCode::TooLarge => "tooLarge".into(),
                        CreationErrorCode::PathEscape => "pathEscape".into(),
                        _ => "unreadable".into(),
                    })
                }
            }
            files.push(entry);
        }
        ancestors.pop();
        Ok(())
    }
}

impl CreationAccess {
    pub fn assistant_overview(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<AssistantProjectOverview, CreationError> {
        let project = self.current(identity, protection)?;
        let snapshot = self.assistant_inventory(identity, protection)?;
        let manifest_status = match project.assistant_text("manifest.json") {
            Ok(text) => {
                if super::super::manifest::parse_manifest(&text).is_ok() {
                    "valid"
                } else {
                    "invalid"
                }
            }
            Err(_) => "unreadable",
        }
        .into();
        let mut evidence = Vec::new();
        let mut content_paths = Vec::new();
        for file in snapshot.files.iter().filter(|file| file.reason.is_none()) {
            let path = &file.path;
            let readme = matches!(
                path.as_str(),
                "README.md" | "README.en.md" | "README.zh-CN.md"
            );
            if readme
                || matches!(
                    path.as_str(),
                    "manifest.json" | "package.json" | "docs/creator-handoff.md"
                )
            {
                evidence.push(self.assistant_read(
                    identity,
                    &AssistantProjectRead {
                        path: path.clone(),
                        version: file.version.clone(),
                        offset: 0,
                        page_length: 800,
                    },
                    protection,
                )?);
            }
            if ["js", "ts", "jsx", "tsx", "html", "scd"]
                .iter()
                .any(|extension| path.ends_with(&format!(".{extension}")))
            {
                if let Ok(text) = project.assistant_text(path) {
                    if text
                        .lines()
                        .any(|line| !line.trim().is_empty() && !line.trim_start().starts_with("//"))
                        && !super::blank::is_blank_source(
                            path,
                            text.as_bytes(),
                            &project.descriptor.name,
                        )
                    {
                        content_paths.push(path.clone());
                    }
                }
            }
        }
        Ok(AssistantProjectOverview {
            snapshot,
            manifest_status,
            content_paths,
            evidence,
        })
    }

    pub fn assistant_inventory(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<AssistantProjectSnapshot, CreationError> {
        let project = self.current(identity, protection)?;
        let mut files = Vec::new();
        project.assistant_walk(
            Path::new(""),
            0,
            &mut files,
            &mut InventoryBudget::default(),
            &mut Vec::new(),
        )?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let fingerprint =
            file_version(&serde_json::to_vec(&files).expect("serializable inventory"));
        Ok(AssistantProjectSnapshot { files, fingerprint })
    }

    pub fn assistant_read(
        &self,
        identity: &str,
        read: &AssistantProjectRead,
        protection: &Protection,
    ) -> Result<AssistantProjectPage, CreationError> {
        let AssistantProjectRead {
            path,
            version,
            offset,
            page_length: length,
        } = read;
        let (offset, length) = (*offset, *length);
        if !(64..=2000).contains(&length) {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "pageLength",
            ));
        }
        let text = self.current(identity, protection)?.assistant_text(path)?;
        let current_version = file_version(text.as_bytes());
        if version
            .as_deref()
            .is_some_and(|version| version != current_version)
        {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "changed",
            ));
        }
        let total_characters = text.encode_utf16().count() as u32;
        if offset > total_characters {
            return Err(CreationError::new(
                CreationErrorCode::VersionConflict,
                "offset",
            ));
        }
        let mut start = text.len();
        let mut end = text.len();
        let mut units = 0;
        let mut actual_offset = total_characters;
        let mut end_offset = total_characters;
        for (byte, ch) in text.char_indices() {
            if units >= offset && start == text.len() {
                start = byte;
                actual_offset = units;
            }
            if units + ch.len_utf16() as u32 > actual_offset.saturating_add(length)
                && start != text.len()
            {
                end = byte;
                end_offset = units;
                break;
            }
            units += ch.len_utf16() as u32;
        }
        let page = &text[start..end];
        let start_line = text[..start].bytes().filter(|byte| *byte == b'\n').count() as u32 + 1;
        let end_line = start_line
            + page
                .trim_end_matches('\n')
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count() as u32;
        Ok(AssistantProjectPage {
            source: None,
            path: path.into(),
            version: current_version,
            text: page.into(),
            offset: actual_offset,
            end_offset,
            total_characters,
            next_offset: (end_offset < total_characters).then_some(end_offset),
            start_line,
            end_line,
        })
    }

    pub fn assistant_search(
        &self,
        identity: &str,
        paths: &[String],
        query: &str,
        protection: &Protection,
    ) -> Result<AssistantProjectSearch, CreationError> {
        if query.trim().is_empty() || query.len() > 256 || paths.len() > READABLE_FILES {
            return Err(CreationError::new(
                CreationErrorCode::TooLarge,
                "searchArguments",
            ));
        }
        let project = self.current(identity, protection)?;
        let mut result = AssistantProjectSearch {
            pages: Vec::new(),
            skipped: Vec::new(),
            searched_files: 0,
            remaining_files: 0,
        };
        for (index, path) in paths.iter().enumerate() {
            if result.pages.len() == 6 || result.searched_files == 64 {
                result.remaining_files = (paths.len() - index) as u32;
                break;
            }
            match project.assistant_text(path) {
                Ok(text) => {
                    result.searched_files += 1;
                    if let Some(byte) = text.to_ascii_lowercase().find(&query.to_ascii_lowercase())
                    {
                        let offset = text[..byte].encode_utf16().count().saturating_sub(120) as u32;
                        result.pages.push(self.assistant_read(
                            identity,
                            &AssistantProjectRead {
                                path: path.clone(),
                                version: Some(file_version(text.as_bytes())),
                                offset,
                                page_length: 400,
                            },
                            protection,
                        )?);
                    }
                }
                Err(error) => result.skipped.push(AssistantProjectFile {
                    path: path.clone(),
                    bytes: 0,
                    version: None,
                    reason: Some(format!("{:?}", error.code)),
                }),
            }
        }
        Ok(result)
    }
}
