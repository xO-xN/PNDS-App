//! Immutable creator-selected text copies, private to the actual project directory.
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterialCopy {
    material: CreationMaterial,
    text: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterialCollection {
    schema: u32,
    project_key: String,
    materials: Vec<MaterialCopy>,
}

impl CreationAccess {
    fn materials_path(
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
            publish(&directory, &collection)?;
        }
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
        let mut collection = load(&directory)?;
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
        let text = String::from_utf8(bytes).map_err(|_| MaterialError::Binary)?;
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
        collection.materials.push(MaterialCopy {
            material: material.clone(),
            text,
        });
        publish(&directory, &collection)?;
        Ok(material)
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
fn valid_name(name: &str) -> bool {
    !name.is_empty()
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
fn load(directory: &File) -> Result<MaterialCollection, MaterialError> {
    Ok(
        read_collection(directory, "materials.json", 2, "project")?
            .unwrap_or_else(empty_collection),
    )
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

fn publish(directory: &File, collection: &MaterialCollection) -> Result<(), MaterialError> {
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
