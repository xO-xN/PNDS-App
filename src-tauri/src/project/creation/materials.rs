//! Versioned pending documents: private independent files and recoverable publication.
use super::*;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::os::unix::fs::PermissionsExt;

const COLLECTION_BYTES: u64 = 8 * 1024 * 1024;
const MATERIAL_COUNT: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum MaterialError {
    InvalidIdentity,
    UnsupportedType,
    Binary,
    TooLarge,
    Unreadable,
    Storage,
    InvalidRecord,
    Missing,
    VersionConflict,
    InvalidRange,
    LimitExceeded,
    NameConflict,
    InvalidName,
    InvalidEncoding,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationMaterial {
    pub id: String,
    pub name: String,
    pub version: String,
    pub size: u32,
    pub total_characters: u32,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationMaterialRead {
    pub id: String,
    pub version: String,
    pub offset: u32,
    pub page_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationMaterialPage {
    pub material: CreationMaterial,
    pub text: String,
    pub offset: u32,
    pub end_offset: u32,
    pub total_characters: u32,
    pub next_offset: Option<u32>,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MaterialCopy {
    pub(super) material: CreationMaterial,
    pub(super) text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MaterialCollection {
    schema: u32,
    project_key: String,
    pub(super) materials: Vec<MaterialCopy>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationPendingDocumentSave {
    pub id: String,
    pub name: String,
    pub text: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationPendingDocument {
    pub document: CreationMaterial,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterialIndex {
    schema: u32,
    documents: Vec<CreationMaterial>,
    fingerprints: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterialPublication {
    before: MaterialIndex,
    after: MaterialCollection,
}

impl CreationAccess {
    pub(super) fn materials_path(
        &self,
        app_data: &Path,
        identity: &str,
        protection: &Protection,
    ) -> Result<File, MaterialError> {
        let project = self
            .current(identity, protection)
            .map_err(|_| MaterialError::InvalidIdentity)?;
        ensure_editable(project).map_err(|_| MaterialError::InvalidIdentity)?;
        let directory =
            crate::creation_data::open(&project.directory).map_err(|_| MaterialError::Storage)?;
        let migration = read_bytes(&directory, "pending-documents.ready", 16)?;
        if migration.as_ref().is_some_and(|bytes| bytes != b"3\n") {
            return Err(MaterialError::InvalidRecord);
        }
        if let Some(index) =
            read_private::<MaterialIndex>(&directory, "pending-documents.json", 128 * 1024)?
        {
            validate_index(&index)?;
            if migration.is_none() {
                publish_bytes(&directory, "pending-documents.ready", b"3\n")?;
            }
            recover_publication(&directory)?;
            return Ok(directory);
        }
        if migration.is_some() {
            return Err(MaterialError::InvalidRecord);
        }
        if read_collection(&directory, "materials.json", 2, "project")?.is_none() {
            let key = digest(project.root.as_os_str().as_bytes());
            let legacy = match OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(app_data.join("assistant-materials"))
            {
                Ok(legacy) => {
                    if legacy
                        .metadata()
                        .map_err(|_| MaterialError::Storage)?
                        .permissions()
                        .mode()
                        & 0o077
                        != 0
                    {
                        return Err(MaterialError::Storage);
                    }
                    read_collection(&legacy, &format!("{key}.json"), 1, &key)?
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => None,
                Err(_) => return Err(MaterialError::Storage),
            };
            let mut collection = legacy.unwrap_or_else(empty_collection);
            collection.schema = 2;
            collection.project_key = "project".into();
            // Keep the validated legacy file as a backup. Even an empty local
            // record is authoritative, so a later removal never resurrects it.
            publish_legacy(&directory, &collection)?;
        }
        if read_private::<MaterialIndex>(&directory, "pending-documents.json", 128 * 1024)?
            .is_none()
        {
            let collection = read_collection(&directory, "materials.json", 2, "project")?
                .ok_or(MaterialError::InvalidRecord)?;
            for copy in &collection.materials {
                let documents = directory_at(&directory, "pending-documents")?;
                let document = directory_at(&documents, &copy.material.id)?;
                if let Some(bytes) = read_bytes(&document, &copy.material.name, TEXT_MAX_BYTES)? {
                    if bytes != copy.text.as_bytes() {
                        return Err(MaterialError::VersionConflict);
                    }
                } else {
                    publish_bytes(&document, &copy.material.name, copy.text.as_bytes())?;
                }
            }
            directory_at(&directory, "pending-documents")?;
            publish_index(&directory, &collection)?;
            publish_bytes(&directory, "pending-documents.ready", b"3\n")?;
        }
        recover_publication(&directory)?;
        Ok(directory)
    }

    pub fn list_materials(
        &self,
        app_data: &Path,
        identity: &str,
        protection: &Protection,
    ) -> Result<Vec<CreationMaterial>, MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        Ok(load(&directory)?
            .materials
            .into_iter()
            .map(|copy| copy.material)
            .collect())
    }

    pub fn add_material(
        &self,
        app_data: &Path,
        identity: &str,
        source: &Path,
        protection: &Protection,
    ) -> Result<CreationMaterial, MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        let collection = load(&directory)?;
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| valid_name(name))
            .ok_or(MaterialError::UnsupportedType)?;
        if file_kind(name) != CreationFileKind::Text {
            return Err(MaterialError::UnsupportedType);
        }
        // Open exactly the selected regular file; never walk its parent, follow
        // a final symlink, read a device, or block on a FIFO.
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(source)
            .map_err(|_| MaterialError::Unreadable)?;
        let metadata = file.metadata().map_err(|_| MaterialError::Unreadable)?;
        if !metadata.is_file() {
            return Err(MaterialError::Unreadable);
        }
        if metadata.len() > TEXT_MAX_BYTES {
            return Err(MaterialError::TooLarge);
        }
        let mut bytes = Vec::new();
        file.take(TEXT_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| MaterialError::Unreadable)?;
        if bytes.len() as u64 > TEXT_MAX_BYTES {
            return Err(MaterialError::TooLarge);
        }
        let text = String::from_utf8(bytes).map_err(|_| MaterialError::InvalidEncoding)?;
        if !valid_text(&text) {
            return Err(MaterialError::Binary);
        }
        if collection.materials.len() >= MATERIAL_COUNT {
            return Err(MaterialError::LimitExceeded);
        }
        let mut random = [0; 16];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| MaterialError::Storage)?;
        let material = CreationMaterial {
            id: random.iter().map(|byte| format!("{byte:02x}")).collect(),
            name: name.into(),
            version: digest(text.as_bytes()),
            size: text.len() as u32,
            total_characters: text.encode_utf16().count() as u32,
        };
        let mut suggested = name.to_string();
        let mut number = 2;
        while collection
            .materials
            .iter()
            .any(|copy| copy.material.name.eq_ignore_ascii_case(&suggested))
        {
            let path = Path::new(name);
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(name);
            suggested = match path.extension().and_then(|value| value.to_str()) {
                Some(extension) => format!("{stem} ({number}).{extension}"),
                None => format!("{name} ({number})"),
            };
            number += 1;
        }
        self.save_pending_document(
            app_data,
            identity,
            &CreationPendingDocumentSave {
                id: material.id,
                name: suggested,
                text,
                version: None,
            },
            protection,
        )
    }

    pub fn save_pending_document(
        &self,
        app_data: &Path,
        identity: &str,
        save: &CreationPendingDocumentSave,
        protection: &Protection,
    ) -> Result<CreationMaterial, MaterialError> {
        if !valid_id(&save.id) {
            return Err(MaterialError::InvalidRecord);
        }
        if !valid_name(&save.name) {
            return Err(MaterialError::InvalidName);
        }
        if file_kind(&save.name) != CreationFileKind::Text {
            return Err(MaterialError::UnsupportedType);
        }
        if save.text.len() as u64 > TEXT_MAX_BYTES {
            return Err(MaterialError::TooLarge);
        }
        if !valid_text(&save.text) {
            return Err(MaterialError::Binary);
        }
        let directory = self.materials_path(app_data, identity, protection)?;
        let mut collection = load(&directory)?;
        let index = collection
            .materials
            .iter()
            .position(|copy| copy.material.id == save.id);
        match (index, &save.version) {
            (Some(index), Some(version))
                if collection.materials[index].material.version == *version => {}
            (None, None) => {}
            _ => return Err(MaterialError::VersionConflict),
        }
        let preserves_name =
            index.is_some_and(|index| collection.materials[index].material.name == save.name);
        if !preserves_name
            && collection.materials.iter().any(|copy| {
                copy.material.id != save.id && copy.material.name.eq_ignore_ascii_case(&save.name)
            })
        {
            return Err(MaterialError::NameConflict);
        }
        let material = CreationMaterial {
            id: save.id.clone(),
            name: save.name.clone(),
            version: saved_version(&save.id, &save.name, &save.text)?,
            size: save.text.len() as u32,
            total_characters: save.text.encode_utf16().count() as u32,
        };
        let copy = MaterialCopy {
            material: material.clone(),
            text: save.text.clone(),
            fingerprint: Some(digest(save.text.as_bytes())),
        };
        if let Some(index) = index {
            collection.materials[index] = copy;
        } else {
            collection.materials.push(copy);
        }
        validate_budget(&collection)?;
        publish(&directory, &collection)?;
        Ok(material)
    }

    pub fn read_pending_document(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<CreationPendingDocument, MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        let copy = load(&directory)?
            .materials
            .into_iter()
            .find(|copy| copy.material.id == id)
            .ok_or(MaterialError::Missing)?;
        if copy.material.version != version {
            return Err(MaterialError::VersionConflict);
        }
        Ok(CreationPendingDocument {
            document: copy.material,
            text: copy.text,
        })
    }

    pub fn rename_pending_document(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        version: &str,
        name: &str,
        protection: &Protection,
    ) -> Result<CreationMaterial, MaterialError> {
        let document = self.read_pending_document(app_data, identity, id, version, protection)?;
        self.save_pending_document(
            app_data,
            identity,
            &CreationPendingDocumentSave {
                id: id.into(),
                name: name.into(),
                text: document.text,
                version: Some(version.into()),
            },
            protection,
        )
    }

    pub fn delete_pending_document(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<(), MaterialError> {
        self.read_pending_document(app_data, identity, id, version, protection)?;
        self.remove_material(app_data, identity, id, protection)
    }

    pub fn pending_document_path(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<PathBuf, MaterialError> {
        let document = self.read_pending_document(app_data, identity, id, version, protection)?;
        let project = self
            .current(identity, protection)
            .map_err(|_| MaterialError::InvalidIdentity)?;
        Ok(project
            .root
            .join(crate::creation_data::DIRECTORY)
            .join("pending-documents")
            .join(id)
            .join(document.document.name))
    }

    pub fn read_material(
        &self,
        app_data: &Path,
        identity: &str,
        read: &CreationMaterialRead,
        protection: &Protection,
    ) -> Result<CreationMaterialPage, MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        let collection = load(&directory)?;
        let copy = collection
            .materials
            .into_iter()
            .find(|copy| copy.material.id == read.id)
            .ok_or(MaterialError::Missing)?;
        if copy.material.version != read.version {
            return Err(MaterialError::VersionConflict);
        }
        if !(64..=65536).contains(&read.page_length) || read.offset > copy.material.total_characters
        {
            return Err(MaterialError::InvalidRange);
        }
        let text = &copy.text;
        let mut start = text.len();
        let mut end = text.len();
        let mut units = 0;
        let mut offset = copy.material.total_characters;
        let mut end_offset = copy.material.total_characters;
        for (byte, ch) in text.char_indices() {
            if units >= read.offset && start == text.len() {
                start = byte;
                offset = units;
            }
            if units + ch.len_utf16() as u32 > offset.saturating_add(read.page_length)
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
        Ok(CreationMaterialPage {
            text: page.into(),
            offset,
            end_offset,
            total_characters: copy.material.total_characters,
            next_offset: (end_offset < copy.material.total_characters).then_some(end_offset),
            material: copy.material,
            start_line,
            end_line,
        })
    }

    /// Resolve only a current private copy; callers never supply an external path.
    pub(super) fn material_text(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<String, MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        let copy = load(&directory)?
            .materials
            .into_iter()
            .find(|copy| copy.material.id == id)
            .ok_or(MaterialError::Missing)?;
        if copy.material.version != version {
            return Err(MaterialError::VersionConflict);
        }
        Ok(copy.text)
    }

    pub fn remove_material(
        &self,
        app_data: &Path,
        identity: &str,
        id: &str,
        protection: &Protection,
    ) -> Result<(), MaterialError> {
        let directory = self.materials_path(app_data, identity, protection)?;
        let mut collection = load(&directory)?;
        let before = collection.materials.len();
        collection.materials.retain(|copy| copy.material.id != id);
        if collection.materials.len() == before {
            return Err(MaterialError::Missing);
        }
        publish(&directory, &collection)
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn saved_version(id: &str, name: &str, text: &str) -> Result<String, MaterialError> {
    let mut random = [0; 32];
    SystemRandom::new()
        .fill(&mut random)
        .map_err(|_| MaterialError::Storage)?;
    let mut hash = Sha256::new();
    hash.update(id.as_bytes());
    hash.update([0]);
    hash.update(name.as_bytes());
    hash.update([0]);
    hash.update(text.as_bytes());
    hash.update(random);
    Ok(format!("{:x}", hash.finalize()))
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !matches!(name, "." | "..")
        && name.len() <= 255
        && !name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\'))
}
fn valid_text(text: &str) -> bool {
    !text
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}
fn empty_collection() -> MaterialCollection {
    MaterialCollection {
        schema: 2,
        project_key: "project".into(),
        materials: vec![],
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn validate_budget(collection: &MaterialCollection) -> Result<(), MaterialError> {
    if collection.materials.len() > MATERIAL_COUNT
        || collection
            .materials
            .iter()
            .map(|copy| copy.text.len() as u64)
            .sum::<u64>()
            > COLLECTION_BYTES
    {
        return Err(MaterialError::LimitExceeded);
    }
    Ok(())
}

pub(super) fn validate_copy(copy: &MaterialCopy) -> Result<(), MaterialError> {
    let material = &copy.material;
    if !valid_id(&material.id)
        || !valid_name(&material.name)
        || file_kind(&material.name) != CreationFileKind::Text
        || copy.text.len() as u64 > TEXT_MAX_BYTES
        || !valid_text(&copy.text)
        || material.size as usize != copy.text.len()
        || material.total_characters != copy.text.encode_utf16().count() as u32
        || material.version.len() != 64
        || !material
            .version
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || copy.fingerprint.as_ref().unwrap_or(&material.version) != &digest(copy.text.as_bytes())
    {
        return Err(MaterialError::InvalidRecord);
    }
    Ok(())
}

pub(super) fn load(directory: &File) -> Result<MaterialCollection, MaterialError> {
    recover_publication(directory)?;
    let index = read_private::<MaterialIndex>(directory, "pending-documents.json", 128 * 1024)?
        .ok_or(MaterialError::InvalidRecord)?;
    validate_index(&index)?;
    let mut collection = empty_collection();
    let documents = open_directory_at(directory, "pending-documents")?;
    let mut changed = false;
    for material in index.documents {
        let document = open_directory_at(&documents, &material.id)?;
        let names = document_names(&document)?;
        if names.is_empty() {
            changed = true;
            continue;
        }
        if names.len() != 1
            || !valid_name(&names[0])
            || file_kind(&names[0]) != CreationFileKind::Text
        {
            return Err(MaterialError::InvalidRecord);
        }
        let name = names[0].clone();
        let bytes = read_bytes(&document, &name, TEXT_MAX_BYTES)?.ok_or(MaterialError::Missing)?;
        let text = String::from_utf8(bytes).map_err(|_| MaterialError::InvalidEncoding)?;
        if !valid_text(&text) {
            return Err(MaterialError::Binary);
        }
        let fingerprint = digest(text.as_bytes());
        let entry_changed =
            name != material.name || index.fingerprints.get(&material.id) != Some(&fingerprint);
        let version = if entry_changed {
            saved_version(&material.id, &name, &text)?
        } else {
            material.version.clone()
        };
        let actual = CreationMaterial {
            id: material.id,
            name,
            version,
            size: text.len() as u32,
            total_characters: text.encode_utf16().count() as u32,
        };
        changed |= entry_changed;
        collection.materials.push(MaterialCopy {
            material: actual,
            text,
            fingerprint: Some(fingerprint),
        });
    }
    validate_budget(&collection)?;
    if changed {
        publish_index(directory, &collection)?;
    }
    Ok(collection)
}

fn validate_index(index: &MaterialIndex) -> Result<(), MaterialError> {
    let mut ids = std::collections::HashSet::new();
    if index.schema != 3
        || index.documents.len() > MATERIAL_COUNT
        || index.fingerprints.len() != index.documents.len()
        || index.documents.iter().any(|document| {
            !valid_id(&document.id)
                || !ids.insert(&document.id)
                || !valid_name(&document.name)
                || file_kind(&document.name) != CreationFileKind::Text
                || document.version.len() != 64
                || !document
                    .version
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
                || document.size as u64 > TEXT_MAX_BYTES
                || index.fingerprints.get(&document.id).is_none_or(|hash| {
                    hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
        })
    {
        return Err(MaterialError::InvalidRecord);
    }
    Ok(())
}

pub(super) fn directory_at(parent: &File, name: &str) -> Result<File, MaterialError> {
    let name = CString::new(name).map_err(|_| MaterialError::InvalidRecord)?;
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0
        && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists
    {
        return Err(MaterialError::Storage);
    }
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(MaterialError::Storage);
    }
    let directory = unsafe { File::from_raw_fd(fd) };
    if directory
        .metadata()
        .map_err(|_| MaterialError::Storage)?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err(MaterialError::Storage);
    }
    Ok(directory)
}

pub(super) fn open_directory_at(parent: &File, name: &str) -> Result<File, MaterialError> {
    let name = CString::new(name).map_err(|_| MaterialError::InvalidRecord)?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(MaterialError::InvalidRecord);
    }
    let directory = unsafe { File::from_raw_fd(fd) };
    if directory
        .metadata()
        .map_err(|_| MaterialError::Storage)?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err(MaterialError::Storage);
    }
    Ok(directory)
}

fn publication_temporary(name: &str) -> bool {
    // A control byte is never a valid document basename, including after an
    // external rename. Ordinary `.pending-*` names remain creator-owned.
    let Some(suffix) = name.strip_prefix("\u{1}.pending-") else {
        return false;
    };
    let Some((pid, serial)) = suffix.split_once('-') else {
        return false;
    };
    pid.bytes().all(|byte| byte.is_ascii_digit())
        && serial.bytes().all(|byte| byte.is_ascii_digit())
        && pid.parse::<u32>().is_ok()
        && serial.parse::<u64>().is_ok()
}

fn document_names(directory: &File) -> Result<Vec<String>, MaterialError> {
    let fd = directory
        .try_clone()
        .map_err(|_| MaterialError::Storage)?
        .into_raw_fd();
    let pointer = unsafe { libc::fdopendir(fd) };
    if pointer.is_null() {
        drop(unsafe { File::from_raw_fd(fd) });
        return Err(MaterialError::Storage);
    }
    let mut names = vec![];
    loop {
        let entry = unsafe { libc::readdir(pointer) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
            .to_str()
            .map_err(|_| MaterialError::InvalidRecord);
        match name {
            Ok(name) if name != "." && name != ".." && !publication_temporary(name) => {
                names.push(name.into())
            }
            Ok(_) => {}
            Err(error) => {
                unsafe { libc::closedir(pointer) };
                return Err(error);
            }
        }
    }
    unsafe { libc::closedir(pointer) };
    Ok(names)
}

fn read_bytes(directory: &File, name: &str, limit: u64) -> Result<Option<Vec<u8>>, MaterialError> {
    let name = CString::new(name).map_err(|_| MaterialError::InvalidRecord)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return if io::Error::last_os_error().kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(MaterialError::Storage)
        };
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(|_| MaterialError::Unreadable)?;
    if !metadata.is_file() {
        return Err(MaterialError::Unreadable);
    }
    if metadata.len() > limit {
        return Err(MaterialError::TooLarge);
    }
    let mut bytes = vec![];
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| MaterialError::Unreadable)?;
    if bytes.len() as u64 > limit {
        return Err(MaterialError::TooLarge);
    }
    Ok(Some(bytes))
}

pub(super) fn read_private<T: serde::de::DeserializeOwned>(
    directory: &File,
    name: &str,
    limit: u64,
) -> Result<Option<T>, MaterialError> {
    read_bytes(directory, name, limit)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| MaterialError::InvalidRecord))
        .transpose()
}

fn publish_index(directory: &File, collection: &MaterialCollection) -> Result<(), MaterialError> {
    let index = MaterialIndex {
        schema: 3,
        documents: collection
            .materials
            .iter()
            .map(|copy| copy.material.clone())
            .collect(),
        fingerprints: collection
            .materials
            .iter()
            .map(|copy| (copy.material.id.clone(), digest(copy.text.as_bytes())))
            .collect(),
    };
    let bytes = serde_json::to_vec(&index).map_err(|_| MaterialError::Storage)?;
    publish_bytes(directory, "pending-documents.json", &bytes)
}

pub(super) fn publish(
    directory: &File,
    collection: &MaterialCollection,
) -> Result<(), MaterialError> {
    validate_budget(collection)?;
    let mut ids = std::collections::HashSet::new();
    for copy in &collection.materials {
        validate_copy(copy)?;
        if !ids.insert(&copy.material.id) {
            return Err(MaterialError::InvalidRecord);
        }
    }
    let before = read_private(directory, "pending-documents.json", 128 * 1024)?
        .ok_or(MaterialError::InvalidRecord)?;
    let operation = MaterialPublication {
        before,
        after: collection.clone(),
    };
    publish_bytes(
        directory,
        "pending-publication.json",
        &serde_json::to_vec(&operation).map_err(|_| MaterialError::Storage)?,
    )?;
    recover_publication(directory)
}

fn recover_publication(directory: &File) -> Result<(), MaterialError> {
    let Some(operation) = read_private::<MaterialPublication>(
        directory,
        "pending-publication.json",
        COLLECTION_BYTES * 6,
    )?
    else {
        return Ok(());
    };
    validate_index(&operation.before)?;
    validate_budget(&operation.after)?;
    let documents = directory_at(directory, "pending-documents")?;
    for copy in &operation.after.materials {
        validate_copy(copy)?;
        let document = directory_at(&documents, &copy.material.id)?;
        let previous = operation
            .before
            .documents
            .iter()
            .find(|before| before.id == copy.material.id);
        if let Some(current) = read_bytes(&document, &copy.material.name, TEXT_MAX_BYTES)? {
            let hash = digest(&current);
            if hash != digest(copy.text.as_bytes())
                && previous.is_none_or(|before| {
                    before.name != copy.material.name
                        || operation.before.fingerprints.get(&before.id) != Some(&hash)
                })
            {
                return Err(MaterialError::VersionConflict);
            }
        } else if let Some(previous) = previous {
            if let Some(current) = read_bytes(&document, &previous.name, TEXT_MAX_BYTES)? {
                if operation.before.fingerprints.get(&previous.id) != Some(&digest(&current)) {
                    return Err(MaterialError::VersionConflict);
                }
            } else {
                return Err(MaterialError::VersionConflict);
            }
        }
    }
    for copy in &operation.after.materials {
        let document = directory_at(&documents, &copy.material.id)?;
        let renamed =
            operation.before.documents.iter().any(|previous| {
                previous.id == copy.material.id && previous.name != copy.material.name
            });
        if renamed
            || read_bytes(&document, &copy.material.name, TEXT_MAX_BYTES)?.as_deref()
                != Some(copy.text.as_bytes())
        {
            publish_bytes(&document, &copy.material.name, copy.text.as_bytes())?;
        }
        if renamed {
            let previous = operation
                .before
                .documents
                .iter()
                .find(|previous| previous.id == copy.material.id)
                .expect("renamed source");
            let names = document_names(&document)?;
            if names.contains(&previous.name) && !names.contains(&copy.material.name) {
                // APFS can preserve an existing entry's case when replacing its
                // bytes. A direct rename publishes the requested basename too.
                let old = CString::new(previous.name.as_str())
                    .map_err(|_| MaterialError::InvalidRecord)?;
                let new = CString::new(copy.material.name.as_str())
                    .map_err(|_| MaterialError::InvalidRecord)?;
                if unsafe {
                    libc::renameat(
                        document.as_raw_fd(),
                        old.as_ptr(),
                        document.as_raw_fd(),
                        new.as_ptr(),
                    )
                } != 0
                {
                    return Err(MaterialError::Storage);
                }
                document.sync_all().map_err(|_| MaterialError::Storage)?;
            }
        }
    }
    publish_index(directory, &operation.after)?;
    for previous in &operation.before.documents {
        let next = operation
            .after
            .materials
            .iter()
            .find(|copy| copy.material.id == previous.id);
        if next.is_some_and(|copy| copy.material.name == previous.name) {
            continue;
        }
        let document = directory_at(&documents, &previous.id)?;
        if !document_names(&document)?.contains(&previous.name) {
            continue;
        }
        if let Some(bytes) = read_bytes(&document, &previous.name, TEXT_MAX_BYTES)? {
            if operation.before.fingerprints.get(&previous.id) != Some(&digest(&bytes)) {
                return Err(MaterialError::VersionConflict);
            }
            unlink(&document, &previous.name)?;
        }
    }
    unlink(directory, "pending-publication.json")
}

pub(super) fn unlink(directory: &File, name: &str) -> Result<(), MaterialError> {
    let name = CString::new(name).map_err(|_| MaterialError::InvalidRecord)?;
    if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0
        && io::Error::last_os_error().kind() != io::ErrorKind::NotFound
    {
        return Err(MaterialError::Storage);
    }
    directory.sync_all().map_err(|_| MaterialError::Storage)
}

pub(super) fn publish_bytes(
    directory: &File,
    name: &str,
    bytes: &[u8],
) -> Result<(), MaterialError> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temporary = CString::new(format!("\u{1}.pending-{pid}-{serial}")).expect("generated name");
    let name = CString::new(name).map_err(|_| MaterialError::InvalidRecord)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            temporary.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(MaterialError::Storage);
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        file.write_all(bytes).map_err(|_| MaterialError::Storage)?;
        file.sync_all().map_err(|_| MaterialError::Storage)?;
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                temporary.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
            )
        } != 0
        {
            return Err(MaterialError::Storage);
        }
        directory.sync_all().map_err(|_| MaterialError::Storage)
    })();
    if result.is_err() {
        unsafe { libc::unlinkat(directory.as_raw_fd(), temporary.as_ptr(), 0) };
    }
    result
}

fn read_collection(
    directory: &File,
    name: &str,
    schema: u32,
    project_key: &str,
) -> Result<Option<MaterialCollection>, MaterialError> {
    let name = CString::new(name).expect("generated material name");
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        if io::Error::last_os_error().kind() == io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(MaterialError::Storage);
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(|_| MaterialError::Storage)?;
    if !metadata.is_file()
        || metadata.len() > COLLECTION_BYTES
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(MaterialError::InvalidRecord);
    }
    let mut bytes = Vec::new();
    file.take(COLLECTION_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| MaterialError::Storage)?;
    if bytes.len() as u64 > COLLECTION_BYTES {
        return Err(MaterialError::InvalidRecord);
    }
    let collection: MaterialCollection =
        serde_json::from_slice(&bytes).map_err(|_| MaterialError::InvalidRecord)?;
    let mut ids = std::collections::HashSet::new();
    if collection.schema != schema
        || collection.project_key != project_key
        || collection.materials.len() > MATERIAL_COUNT
        || collection.materials.iter().any(|copy| {
            let material = &copy.material;
            !ids.insert(&material.id)
                || material.id.len() != 32
                || !material.id.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !valid_name(&material.name)
                || file_kind(&material.name) != CreationFileKind::Text
                || copy.text.len() as u64 > TEXT_MAX_BYTES
                || !valid_text(&copy.text)
                || material.size != copy.text.len() as u32
                || material.total_characters != copy.text.encode_utf16().count() as u32
                || material.version != digest(copy.text.as_bytes())
        })
    {
        return Err(MaterialError::InvalidRecord);
    }
    Ok(Some(collection))
}

fn publish_legacy(directory: &File, collection: &MaterialCollection) -> Result<(), MaterialError> {
    let bytes = serde_json::to_vec(collection).map_err(|_| MaterialError::Storage)?;
    if bytes.len() as u64 > COLLECTION_BYTES {
        return Err(MaterialError::LimitExceeded);
    }
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temporary = CString::new(format!(".materials-{pid}-{serial}")).expect("generated name");
    let directory_fd = directory.as_raw_fd();
    let fd = unsafe {
        libc::openat(
            directory_fd,
            temporary.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(MaterialError::Storage);
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        file.write_all(&bytes).map_err(|_| MaterialError::Storage)?;
        file.sync_all().map_err(|_| MaterialError::Storage)?;
        let name = CString::new("materials.json").expect("fixed name");
        if unsafe {
            libc::renameat(
                directory_fd,
                temporary.as_ptr(),
                directory_fd,
                name.as_ptr(),
            )
        } != 0
        {
            return Err(MaterialError::Storage);
        }
        // Rename is publication: a later directory sync cannot undo success.
        let _ = directory.sync_all();
        Ok(())
    })();
    if result.is_err() {
        unsafe { libc::unlinkat(directory_fd, temporary.as_ptr(), 0) };
    }
    result
}
