//! Private media copies keep their original bytes separate from the catalog.
use super::*;
#[cfg(target_os = "macos")]
use std::io::Seek;

const CATALOG: &str = "pending-media.json";
const BODIES: &str = "pending-media";
pub(in crate::project::creation) const IMAGE_LIMIT: u64 = 16 * 1024 * 1024;
const IMAGE_COLLECTION_LIMIT: u64 = 128 * 1024 * 1024;
const AUDIO_LIMIT: u64 = 512 * 1024 * 1024;
const AUDIO_COLLECTION_LIMIT: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationPendingMedia {
    pub id: String,
    pub name: String,
    pub version: String,
    pub size: u32,
    pub mime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
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
        let name = source.file_name().and_then(|name| name.to_str());
        if name.and_then(image_mime).is_some() {
            self.add_pending_image(identity, source, protection)
                .map(ImportedCreationResource::Media)
        } else if name.and_then(audio_format).is_some() {
            #[cfg(target_os = "macos")]
            {
                let prepared = prepare_audio_import(source)?;
                self.publish_audio_import(identity, prepared, protection)
                    .map(ImportedCreationResource::Media)
            }
            #[cfg(not(target_os = "macos"))]
            Err(MaterialError::UnsupportedType)
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
        let name = import_name(source)?;
        let mime = image_mime(name).ok_or(MaterialError::UnsupportedType)?;
        let directory = self.pending_media_directory(identity, protection)?;
        let catalog = load_catalog(&directory)?;
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
        check_budget(&catalog, bytes.len() as u64, false)?;
        let (width, height) = image_dimensions(mime, &bytes).unzip();
        let image = CreationPendingMedia {
            id: new_material_id()?,
            name: name.into(),
            version: digest(&bytes),
            size: bytes.len() as u32,
            mime: mime.into(),
            duration_ms: None,
            width,
            height,
        };
        publish_media(&directory, catalog, image, |file| file.write_all(&bytes))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn publish_audio_import(
        &self,
        identity: &str,
        mut prepared: AudioImport,
        protection: &Protection,
    ) -> Result<CreationPendingMedia, MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let catalog = load_catalog(&directory)?;
        check_budget(&catalog, u64::from(prepared.media.size), true)?;
        prepared.copy.rewind().map_err(|_| MaterialError::Storage)?;
        publish_media(&directory, catalog, prepared.media, |file| {
            io::copy(prepared.copy.as_file_mut(), file).map(|_| ())
        })
    }

    pub(crate) fn pending_image_metadata(
        &self,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<CreationPendingMedia, MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let media = find_media(&directory, id, version)?;
        if image_mime(&media.name).is_none() {
            return Err(MaterialError::UnsupportedType);
        }
        Ok(media)
    }

    pub(crate) fn pending_image_path(
        &self,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<PathBuf, MaterialError> {
        let metadata = self.pending_image_metadata(identity, id, version, protection)?;
        let project = self
            .current(identity, protection)
            .map_err(|_| MaterialError::InvalidIdentity)?;
        Ok(project
            .root
            .join(crate::creation_data::DIRECTORY)
            .join(BODIES)
            .join(metadata.id))
    }

    pub(crate) fn read_pending_image(
        &self,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<(String, Vec<u8>), MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let image = find_media(&directory, id, version)?;
        if image_mime(&image.name).is_none() {
            return Err(MaterialError::UnsupportedType);
        }
        let bytes = read_image_body(&directory, &image)?;
        Ok((image.mime, bytes))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn prepare_pending_audio(
        &self,
        identity: &str,
        id: &str,
        version: &str,
        protection: &Protection,
    ) -> Result<(File, CreationPendingMedia), MaterialError> {
        let directory = self.pending_media_directory(identity, protection)?;
        let media = find_media(&directory, id, version)?;
        if audio_format(&media.name).is_none() {
            return Err(MaterialError::UnsupportedType);
        }
        let bodies = open_directory_at(&directory, BODIES)?;
        let id = CString::new(media.id.as_str()).map_err(|_| MaterialError::InvalidRecord)?;
        // The catalog validates the generated ID. The final file cannot be a symlink.
        let fd = unsafe {
            libc::openat(
                bodies.as_raw_fd(),
                id.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(MaterialError::Unreadable);
        }
        Ok((unsafe { File::from_raw_fd(fd) }, media))
    }
}

fn read_image_body(
    directory: &File,
    image: &CreationPendingMedia,
) -> Result<Vec<u8>, MaterialError> {
    if !valid_id(&image.id)
        || !valid_name(&image.name)
        || image_mime(&image.name) != Some(&image.mime)
    {
        return Err(MaterialError::InvalidRecord);
    }
    let bodies = open_directory_at(directory, BODIES)?;
    let bytes = read_bytes(&bodies, &image.id, IMAGE_LIMIT)?.ok_or(MaterialError::Missing)?;
    if bytes.len() != image.size as usize || digest(&bytes) != image.version {
        return Err(MaterialError::VersionConflict);
    }
    if !matches_image_signature(&image.mime, &bytes) {
        return Err(MaterialError::InvalidImage);
    }
    Ok(bytes)
}

pub(in crate::project::creation) fn update_pending_image_originals(
    directory: &File,
    originals: &[CreationPendingMedia],
    restore: bool,
    publish: bool,
) -> Result<(), MaterialError> {
    if originals.is_empty() {
        return Ok(());
    }
    let mut catalog = load_catalog(directory)?;
    for original in originals {
        read_image_body(directory, original)?;
        let present = catalog.entries.iter().find(|entry| entry.id == original.id);
        if present.is_some_and(|entry| entry != original)
            || restore
                && catalog.entries.iter().any(|entry| {
                    entry.id != original.id && entry.name.eq_ignore_ascii_case(&original.name)
                })
        {
            return Err(MaterialError::VersionConflict);
        }
        if restore {
            if present.is_none() {
                check_budget(&catalog, u64::from(original.size), false)?;
                catalog.entries.push(original.clone());
            }
        } else {
            catalog.entries.retain(|entry| entry.id != original.id);
        }
    }
    if publish {
        let bytes = serde_json::to_vec(&catalog).map_err(|_| MaterialError::Storage)?;
        publish_bytes(directory, CATALOG, &bytes)?;
    }
    Ok(())
}

pub(in crate::project::creation) fn reclaim_retired_image_originals(
    directory: &File,
    previous: &[CreationPendingMedia],
    current: &[CreationPendingMedia],
) {
    let Ok(catalog) = load_catalog(directory) else {
        return;
    };
    let Ok(bodies) = open_directory_at(directory, BODIES) else {
        return;
    };
    for original in previous.iter().filter(|original| {
        !current.iter().any(|entry| entry.id == original.id)
            && !catalog.entries.iter().any(|entry| entry.id == original.id)
    }) {
        let _ = unlink(&bodies, &original.id);
    }
}

fn import_name(source: &Path) -> Result<&str, MaterialError> {
    source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_name(name))
        .ok_or(MaterialError::UnsupportedType)
}

fn audio_format(name: &str) -> Option<(&'static str, &'static str)> {
    match Path::new(name)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "wav" => Some(("audio/wav", ".wav")),
        "mp3" => Some(("audio/mpeg", ".mp3")),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub(crate) struct AudioImport {
    media: CreationPendingMedia,
    copy: tempfile::NamedTempFile,
}

#[cfg(target_os = "macos")]
pub(crate) fn is_pending_audio_source(path: &Path) -> bool {
    import_name(path).ok().and_then(audio_format).is_some()
}

#[cfg(target_os = "macos")]
pub(crate) fn prepare_audio_import(source: &Path) -> Result<AudioImport, MaterialError> {
    let name = import_name(source)?;
    let (mime, suffix) = audio_format(name).ok_or(MaterialError::UnsupportedType)?;
    let (mut copy, size, version) = audio_snapshot(open_import_file(source)?, suffix)?;
    validate_audio_signature(copy.as_file_mut(), mime)?;
    let duration_ms = crate::project::audio_preview::duration_ms(copy.path())
        .map_err(|_| MaterialError::InvalidAudio)?;
    Ok(AudioImport {
        media: CreationPendingMedia {
            id: new_material_id()?,
            name: name.into(),
            version,
            size: size as u32,
            mime: mime.into(),
            duration_ms: Some(duration_ms),
            width: None,
            height: None,
        },
        copy,
    })
}

#[cfg(target_os = "macos")]
impl CreationPendingMedia {
    pub(crate) fn verified_audio_copy(
        &self,
        file: File,
    ) -> Result<tempfile::NamedTempFile, MaterialError> {
        let (_, suffix) = audio_format(&self.name).ok_or(MaterialError::UnsupportedType)?;
        let (mut copy, size, version) = audio_snapshot(file, suffix)?;
        if size != u64::from(self.size) || version != self.version {
            return Err(MaterialError::VersionConflict);
        }
        validate_audio_signature(copy.as_file_mut(), &self.mime)?;
        Ok(copy)
    }
}

#[cfg(target_os = "macos")]
fn validate_audio_signature(copy: &mut File, mime: &str) -> Result<(), MaterialError> {
    copy.rewind().map_err(|_| MaterialError::Storage)?;
    let mut header = [0; 12];
    copy.read_exact(&mut header)
        .map_err(|_| MaterialError::InvalidAudio)?;
    let matches = match mime {
        "audio/wav" => {
            (&header[..4] == b"RIFF" || &header[..4] == b"RF64") && &header[8..] == b"WAVE"
        }
        "audio/mpeg" => {
            header.starts_with(b"ID3") || (header[0] == 0xff && header[1] & 0xe0 == 0xe0)
        }
        _ => false,
    };
    matches.then_some(()).ok_or(MaterialError::InvalidAudio)
}

#[cfg(target_os = "macos")]
fn audio_snapshot(
    file: File,
    suffix: &str,
) -> Result<(tempfile::NamedTempFile, u64, String), MaterialError> {
    let metadata = file.metadata().map_err(|_| MaterialError::Unreadable)?;
    if !metadata.is_file() {
        return Err(MaterialError::Unreadable);
    }
    if metadata.len() > AUDIO_LIMIT {
        return Err(MaterialError::AudioTooLarge);
    }
    let mut file = file.take(AUDIO_LIMIT + 1);
    let mut copy = tempfile::Builder::new()
        .prefix("pnds-audition-")
        .suffix(suffix)
        .tempfile()
        .map_err(|_| MaterialError::Storage)?;
    let mut bytes = vec![0; 64 * 1024];
    let mut digest = Sha256::new();
    let mut size = 0;
    loop {
        let count = file
            .read(&mut bytes)
            .map_err(|_| MaterialError::Unreadable)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > AUDIO_LIMIT {
            return Err(MaterialError::AudioTooLarge);
        }
        let chunk = &bytes[..count];
        digest.update(chunk);
        copy.write_all(chunk).map_err(|_| MaterialError::Storage)?;
    }
    copy.flush().map_err(|_| MaterialError::Storage)?;
    Ok((copy, size, format!("{:x}", digest.finalize())))
}

fn publish_media(
    directory: &File,
    mut catalog: MediaCatalog,
    media: CreationPendingMedia,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> Result<CreationPendingMedia, MaterialError> {
    let bodies = directory_at(directory, BODIES)?;
    publish_file(&bodies, &media.id, write)?;
    catalog.entries.push(media.clone());
    // The catalog is published last, so interrupted writes cannot list a partial body.
    let catalog_bytes = serde_json::to_vec(&catalog).map_err(|_| MaterialError::Storage)?;
    if let Err(error) = publish_bytes(directory, CATALOG, &catalog_bytes) {
        if load_catalog(directory)
            .is_ok_and(|saved| !saved.entries.iter().any(|entry| entry.id == media.id))
        {
            let _ = unlink(&bodies, &media.id);
        }
        return Err(error);
    }
    Ok(media)
}

fn find_media(
    directory: &File,
    id: &str,
    version: &str,
) -> Result<CreationPendingMedia, MaterialError> {
    let media = load_catalog(directory)?
        .entries
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or(MaterialError::Missing)?;
    if media.version != version {
        return Err(MaterialError::VersionConflict);
    }
    Ok(media)
}

fn load_catalog(directory: &File) -> Result<MediaCatalog, MaterialError> {
    let catalog: MediaCatalog = read_private(directory, CATALOG, 128 * 1024)?.unwrap_or_default();
    let mut ids = std::collections::BTreeSet::new();
    if catalog.entries.len() > MATERIAL_COUNT
        || catalog_size(&catalog, false) > IMAGE_COLLECTION_LIMIT
        || catalog_size(&catalog, true) > AUDIO_COLLECTION_LIMIT
        || catalog.entries.iter().any(|media| {
            let supported = if let Some(mime) = image_mime(&media.name) {
                mime == media.mime
                    && media.duration_ms.is_none()
                    && media.width.is_some() == media.height.is_some()
                    && media.width.is_none_or(|value| value > 0)
                    && media.height.is_none_or(|value| value > 0)
                    && u64::from(media.size) <= IMAGE_LIMIT
            } else if let Some((mime, _)) = audio_format(&media.name) {
                mime == media.mime
                    && media.width.is_none()
                    && media.height.is_none()
                    && media.duration_ms.is_some_and(|duration| duration > 0)
                    && u64::from(media.size) <= AUDIO_LIMIT
            } else {
                false
            };
            !supported
                || !valid_id(&media.id)
                || !ids.insert(&media.id)
                || !valid_name(&media.name)
                || media.version.len() != 64
                || !media.version.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(MaterialError::InvalidRecord);
    }
    Ok(catalog)
}

fn catalog_size(catalog: &MediaCatalog, audio: bool) -> u64 {
    catalog
        .entries
        .iter()
        .filter(|entry| entry.mime.starts_with("audio/") == audio)
        .map(|entry| u64::from(entry.size))
        .sum()
}

fn check_budget(catalog: &MediaCatalog, size: u64, audio: bool) -> Result<(), MaterialError> {
    let (limit, error) = if audio {
        (AUDIO_COLLECTION_LIMIT, MaterialError::AudioLimitExceeded)
    } else {
        (IMAGE_COLLECTION_LIMIT, MaterialError::MediaLimitExceeded)
    };
    if catalog.entries.len() >= MATERIAL_COUNT || size + catalog_size(catalog, audio) > limit {
        return Err(error);
    }
    Ok(())
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

fn image_dimensions(mime: &str, bytes: &[u8]) -> Option<(u32, u32)> {
    let be32 = |offset| {
        Some(u32::from_be_bytes(
            bytes.get(offset..offset + 4)?.try_into().ok()?,
        ))
    };
    let le16 = |offset| {
        Some(u32::from(u16::from_le_bytes(
            bytes.get(offset..offset + 2)?.try_into().ok()?,
        )))
    };
    let (width, height) = match mime {
        "image/png" if bytes.get(12..16) == Some(b"IHDR") => (be32(16)?, be32(20)?),
        "image/gif" => (le16(6)?, le16(8)?),
        "image/webp" if bytes.get(12..16) == Some(b"VP8X") => {
            let le24 = |offset: usize| {
                let slice = bytes.get(offset..offset + 3)?;
                Some(1 + u32::from_le_bytes([slice[0], slice[1], slice[2], 0]))
            };
            (le24(24)?, le24(27)?)
        }
        "image/webp"
            if bytes.get(12..16) == Some(b"VP8 ") && bytes.get(23..26) == Some(b"\x9d\x01\x2a") =>
        {
            (le16(26)? & 0x3fff, le16(28)? & 0x3fff)
        }
        "image/webp" if bytes.get(12..16) == Some(b"VP8L") && bytes.get(20) == Some(&0x2f) => {
            let bits = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
            (1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))
        }
        "image/jpeg" => jpeg_dimensions(bytes)?,
        _ => return None,
    };
    (width > 0 && height > 0).then_some((width, height))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut offset = 2;
    while bytes.get(offset) == Some(&0xff) {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if matches!(marker, 0xd9 | 0xda) {
            return None;
        }
        if matches!(marker, 0x01 | 0xd0..=0xd7) {
            continue;
        }
        let len = usize::from(u16::from_be_bytes(
            bytes.get(offset..offset + 2)?.try_into().ok()?,
        ));
        if len < 2 {
            return None;
        }
        let segment = bytes.get(offset..offset + len)?;
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let read = |start| {
                Some(u32::from(u16::from_be_bytes(
                    segment.get(start..start + 2)?.try_into().ok()?,
                )))
            };
            return Some((read(5)?, read(3)?));
        }
        offset += len;
    }
    None
}
