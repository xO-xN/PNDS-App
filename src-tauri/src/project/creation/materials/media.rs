//! Private media copies keep their original bytes separate from the catalog.
use super::*;

const CATALOG: &str = "pending-media.json";
const BODIES: &str = "pending-media";
const IMAGE_LIMIT: u64 = 16 * 1024 * 1024;
const COLLECTION_LIMIT: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationPendingMedia {
    pub id: String,
    pub name: String,
    pub version: String,
    pub size: u32,
    pub mime: String,
}

#[derive(Serialize, Type)]
#[serde(untagged)]
pub enum ImportedCreationResource {
    Document(CreationMaterial),
    Media(CreationPendingMedia),
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaCatalog {
    entries: Vec<CreationPendingMedia>,
}

impl CreationAccess {
    pub fn import_creation_resource(
        &self,
        app_data: &Path,
        identity: &str,
        source: &Path,
        protection: &Protection,
    ) -> Result<ImportedCreationResource, MaterialError> {
        if source
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(image_mime)
            .is_some()
        {
            self.add_pending_image(identity, source, protection)
                .map(ImportedCreationResource::Media)
        } else {
            self.add_material(app_data, identity, source, protection)
                .map(ImportedCreationResource::Document)
        }
    }

    fn pending_media_directory(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<File, MaterialError> {
        let project = self
            .current(identity, protection)
            .map_err(|_| MaterialError::InvalidIdentity)?;
        ensure_editable(project).map_err(|_| MaterialError::InvalidIdentity)?;
        crate::creation_data::open(&project.directory).map_err(|_| MaterialError::Storage)
    }

    pub fn list_pending_media(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<Vec<CreationPendingMedia>, MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        Ok(load_catalog(&directory)?.entries)
    }

    pub(crate) fn add_pending_image(
        &self,
        identity: &str,
        source: &Path,
        protection: &Protection,
    ) -> Result<CreationPendingMedia, MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let mut catalog = load_catalog(&directory)?;
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| valid_name(name))
            .ok_or(MaterialError::UnsupportedType)?;
        let mime = image_mime(name).ok_or(MaterialError::UnsupportedType)?;
        let bytes = read_import_file(source, IMAGE_LIMIT).map_err(|error| {
            if error == MaterialError::TooLarge {
                MaterialError::ImageTooLarge
            } else {
                error
            }
        })?;
        if !matches_image_signature(mime, &bytes) {
            return Err(MaterialError::InvalidImage);
        }
        if catalog.entries.len() >= MATERIAL_COUNT
            || bytes.len() as u64 + catalog_size(&catalog) > COLLECTION_LIMIT
        {
            return Err(MaterialError::MediaLimitExceeded);
        }
        let image = CreationPendingMedia {
            id: new_material_id()?,
            name: name.into(),
            version: digest(&bytes),
            size: bytes.len() as u32,
            mime: mime.into(),
        };
        let bodies = directory_at(&directory, BODIES)?;
        publish_bytes(&bodies, &image.id, &bytes)?;
        catalog.entries.push(image.clone());
        // Publishing the index last prevents interrupted imports from listing
        // partial files. Keep a body if index publication may have succeeded.
        let catalog_bytes = serde_json::to_vec(&catalog).map_err(|_| MaterialError::Storage)?;
        if let Err(error) = publish_bytes(&directory, CATALOG, &catalog_bytes) {
            if load_catalog(&directory)
                .is_ok_and(|saved| !saved.entries.iter().any(|entry| entry.id == image.id))
            {
                let _ = unlink(&bodies, &image.id);
            }
            return Err(error);
        }
        Ok(image)
    }

    pub(crate) fn read_pending_image(
        &self,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<(String, Vec<u8>), MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let catalog = load_catalog(&directory)?;
        let image = catalog
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or(MaterialError::Missing)?;
        if image.version != version {
            return Err(MaterialError::VersionConflict);
        }
        let bodies = open_directory_at(&directory, BODIES)?;
        let bytes = read_bytes(&bodies, &image.id, IMAGE_LIMIT)?.ok_or(MaterialError::Missing)?;
        if bytes.len() != image.size as usize || digest(&bytes) != image.version {
            return Err(MaterialError::VersionConflict);
        }
        if !matches_image_signature(&image.mime, &bytes) {
            return Err(MaterialError::InvalidImage);
        }
        Ok((image.mime.clone(), bytes))
    }
}

fn load_catalog(directory: &File) -> Result<MediaCatalog, MaterialError> {
    let catalog: MediaCatalog = read_private(directory, CATALOG, 128 * 1024)?.unwrap_or_default();
    let mut ids = std::collections::BTreeSet::new();
    if catalog.entries.len() > MATERIAL_COUNT
        || catalog_size(&catalog) > COLLECTION_LIMIT
        || catalog.entries.iter().any(|image| {
            !valid_id(&image.id)
                || !ids.insert(&image.id)
                || !valid_name(&image.name)
                || image_mime(&image.name) != Some(image.mime.as_str())
                || u64::from(image.size) > IMAGE_LIMIT
                || image.version.len() != 64
                || !image.version.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(MaterialError::InvalidRecord);
    }
    Ok(catalog)
}

fn catalog_size(catalog: &MediaCatalog) -> u64 {
    catalog
        .entries
        .iter()
        .map(|entry| u64::from(entry.size))
        .sum()
}

fn matches_image_signature(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}
