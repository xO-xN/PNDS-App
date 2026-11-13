//! Project-root cover image reading (v1.5.0, the README cover page).
//!
//! The optional creator screenshot shown in the README panel's lower
//! band. One file, probed in a fixed extension order (`cover.png` →
//! `cover.jpg` → `cover.jpeg` → `cover.webp`, first hit wins — the
//! naming convention lives in the creator manual). Served as a base64
//! data URL so the webview needs no asset-protocol scope. Same posture
//! as the README read: `Ok(None)` means no cover anywhere (a missing
//! cover only drops the band's image, never an error surface), while a
//! present-but-unservable cover (unreadable, oversized) is a readable
//! error — the frontend logs it and renders the band without the image.

use super::contained_read::ReadRoot;
use base64::Engine as _;
use std::ffi::CString;
use std::fs::File;
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::{Path, PathBuf};

/// The cover filename stem the README panel probes.
pub const COVER_FILE_STEM: &str = "cover";

/// Probe order → data-URL MIME type. Keep in lockstep with the creator
/// manual's naming convention (readme-guide).
const COVER_EXTENSIONS: [(&str, &str); 4] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
];

/// Hard cap on a cover the panel will serve — a cover beyond this is
/// refused with a readable error instead of pushing megabytes through
/// the IPC bridge. The manual advises staying under ~2 MB; the cap is
/// the venue-robustness ceiling above that advice.
const COVER_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// Capture the current run's optional raster cover from a fixed root filename.
pub(crate) fn capture_participation_cover(root: &Path) -> Option<(&'static str, Vec<u8>)> {
    let root = ReadRoot::new(root).ok()?;
    for (extension, mime) in COVER_EXTENSIONS {
        let name = CString::new(format!("{COVER_FILE_STEM}.{extension}")).ok()?;
        // ReadRoot::open resolves links within the project. A published cover
        // must itself be a regular file, opened from the held directory.
        let fd = unsafe {
            libc::openat(
                root.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            continue;
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata().ok()?;
        if !metadata.is_file() {
            continue;
        }
        if metadata.len() > COVER_MAX_BYTES {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(COVER_MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        root.check_current().ok()?;
        return (bytes.len() as u64 <= COVER_MAX_BYTES).then_some((mime, bytes));
    }
    None
}

/// Reads a project's cover image as a data URL: the first
/// `cover.<ext>` hit in probe order, base64-encoded with the matching
/// MIME type. `Ok(None)` when the project ships no cover (or the
/// project directory itself is gone).
pub fn read_project_cover(root: PathBuf) -> Result<Option<String>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    for (extension, mime) in COVER_EXTENSIONS {
        let candidate = root.join(format!("{COVER_FILE_STEM}.{extension}"));
        match read_cover_candidate(&candidate, mime) {
            Ok(None) => continue,
            other => return other,
        }
    }
    Ok(None)
}

/// One cover candidate: `Ok(None)` when it does not exist (or is not a
/// file — a directory named like a cover is simply not one, the probe
/// moves on); a present candidate must be readable and within the cap,
/// and is returned as a data URL.
fn read_cover_candidate(candidate: &Path, mime: &str) -> Result<Option<String>, String> {
    let metadata = match std::fs::metadata(candidate) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to stat {}: {e}", candidate.display())),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > COVER_MAX_BYTES {
        return Err(format!(
            "{} is too large to show ({} bytes; the cap is {})",
            candidate.display(),
            metadata.len(),
            COVER_MAX_BYTES
        ));
    }
    let bytes = std::fs::read(candidate)
        .map_err(|e| format!("Failed to read {}: {e}", candidate.display()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn participation_capture_uses_fixed_probe_order_and_raster_types() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(capture_participation_cover(dir.path()), None);
        for (extension, mime) in COVER_EXTENSIONS.into_iter().rev() {
            let bytes = extension.as_bytes();
            fs::write(dir.path().join(format!("cover.{extension}")), bytes).unwrap();
            assert_eq!(
                capture_participation_cover(dir.path()),
                Some((mime, bytes.to_vec()))
            );
        }
    }

    #[test]
    fn participation_capture_rejects_links_and_non_regular_files() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), "outside").unwrap();
        fs::write(dir.path().join("inside.png"), "inside").unwrap();
        std::os::unix::fs::symlink("inside.png", dir.path().join("cover.png")).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("cover.jpg")).unwrap();
        fs::create_dir(dir.path().join("cover.jpeg")).unwrap();
        assert_eq!(capture_participation_cover(dir.path()), None);
        fs::write(dir.path().join("cover.webp"), [1, 2, 3]).unwrap();
        assert_eq!(
            capture_participation_cover(dir.path()),
            Some(("image/webp", vec![1, 2, 3]))
        );
    }

    #[test]
    fn participation_capture_applies_the_cover_size_cap() {
        let dir = tempfile::tempdir().unwrap();
        let cover = fs::File::create(dir.path().join("cover.png")).unwrap();
        cover.set_len(COVER_MAX_BYTES + 1).unwrap();
        assert_eq!(capture_participation_cover(dir.path()), None);
        cover.set_len(COVER_MAX_BYTES).unwrap();
        let (mime, bytes) = capture_participation_cover(dir.path()).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes.len() as u64, COVER_MAX_BYTES);
    }

    /// The cover read contract behind the README panel's band: the
    /// probe order is fixed, a missing cover is a clean None, and a
    /// present-but-unservable cover is a readable error.
    #[test]
    fn probes_in_order_and_first_hit_wins() {
        let parent = tempfile::tempdir().unwrap();

        // All four present: png wins.
        let all = parent.path().join("All");
        fs::create_dir_all(&all).unwrap();
        for (extension, _) in COVER_EXTENSIONS {
            fs::write(all.join(format!("cover.{extension}")), [0u8, 1, 2]).unwrap();
        }
        let url = read_project_cover(all).unwrap().expect("png must win");
        assert!(url.starts_with("data:image/png;base64,"), "got: {url}");

        // png absent: jpg wins with its own MIME type.
        let jpg = parent.path().join("Jpg");
        fs::create_dir_all(&jpg).unwrap();
        fs::write(jpg.join("cover.jpg"), [3u8, 4]).unwrap();
        fs::write(jpg.join("cover.webp"), [5u8, 6]).unwrap();
        let url = read_project_cover(jpg).unwrap().expect("jpg must win");
        assert!(url.starts_with("data:image/jpeg;base64,"), "got: {url}");

        // jpeg spelled out: same MIME type as jpg.
        let jpeg = parent.path().join("Jpeg");
        fs::create_dir_all(&jpeg).unwrap();
        fs::write(jpeg.join("cover.jpeg"), [7u8]).unwrap();
        let url = read_project_cover(jpeg).unwrap().expect("jpeg must win");
        assert!(url.starts_with("data:image/jpeg;base64,"), "got: {url}");
    }

    #[test]
    fn round_trips_the_bytes_into_the_data_url() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cover.png"), [0u8, 1, 2, 250]).unwrap();

        let url = read_project_cover(dir.path().to_path_buf())
            .unwrap()
            .expect("cover must serve");
        let body = url.strip_prefix("data:image/png;base64,").unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(body)
            .unwrap();
        assert_eq!(decoded, vec![0u8, 1, 2, 250]);
    }

    #[test]
    fn missing_everywhere_is_none() {
        // No directory at all (a stale index entry on a moved project).
        assert_eq!(
            read_project_cover(PathBuf::from("/nonexistent/project")),
            Ok(None)
        );

        // A directory with no cover of any extension.
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_project_cover(dir.path().to_path_buf()), Ok(None));

        // A directory where cover.png is itself a directory: skipped,
        // the probe continues and finds nothing.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("cover.png")).unwrap();
        assert_eq!(read_project_cover(dir.path().to_path_buf()), Ok(None));
    }

    #[test]
    fn refuses_an_oversized_cover_readably() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("cover.png"),
            vec![0u8; (COVER_MAX_BYTES + 1) as usize],
        )
        .unwrap();

        let err = read_project_cover(dir.path().to_path_buf()).expect_err("oversized must refuse");
        assert!(err.contains("too large"), "readable error, got: {err}");
        assert!(err.contains("cover.png"), "names the file: {err}");
    }
}
