//! Project-root README reading (v1.5.0, #125).
//!
//! The optional, author-written document the main area renders when the
//! project's card is selected. `Ok(None)` means nothing to render — no
//! README, or the project directory itself is gone (preflight owns the
//! real diagnostics when starting); a README that exists but cannot be
//! served (unreadable, invalid UTF-8, oversized) is an explicit,
//! readable error the frontend surfaces as a distinct read-failure
//! state, never as the "no README" empty state.

use std::path::PathBuf;

/// The project-root README filename the main area reads.
pub const PROJECT_README_FILE: &str = "README.md";

/// Hard cap on a README the renderer will accept — a project README
/// beyond this is refused with a readable error instead of janking the
/// main-area webview on megabytes of markdown.
const PROJECT_README_MAX_BYTES: u64 = 512 * 1024;

/// Reads a project's root README.md for the display routing.
pub fn read_project_readme(root: PathBuf) -> Result<Option<String>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let readme = root.join(PROJECT_README_FILE);
    let metadata = match std::fs::metadata(&readme) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to stat {}: {e}", readme.display())),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > PROJECT_README_MAX_BYTES {
        return Err(format!(
            "README.md is too large to render ({} bytes; the cap is {})",
            metadata.len(),
            PROJECT_README_MAX_BYTES
        ));
    }
    std::fs::read_to_string(&readme)
        .map(Some)
        .map_err(|e| format!("Failed to read {}: {e}", readme.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #125: the read contract behind the main area's project README
    /// routing — missing pieces are the empty state (None), a present
    /// README round-trips verbatim, and unreadable ones error readably
    /// instead of half-rendering.
    #[test]
    fn reads_missing_pieces_as_none() {
        // No directory at all (a stale index entry on a moved project).
        assert_eq!(
            read_project_readme(PathBuf::from("/nonexistent/project")),
            Ok(None)
        );

        // A directory without a README.md.
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_project_readme(dir.path().to_path_buf()), Ok(None));

        // A directory where README.md is itself a directory.
        std::fs::create_dir(dir.path().join(PROJECT_README_FILE)).unwrap();
        assert_eq!(read_project_readme(dir.path().to_path_buf()), Ok(None));
    }

    #[test]
    fn reads_a_present_readme_verbatim() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(PROJECT_README_FILE),
            "# Night Sky\n\nTwo sets, GFM tables welcome.",
        )
        .unwrap();

        assert_eq!(
            read_project_readme(dir.path().to_path_buf()),
            Ok(Some(
                "# Night Sky\n\nTwo sets, GFM tables welcome.".to_string()
            ))
        );
    }

    #[test]
    fn refuses_an_oversized_readme_readably() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(PROJECT_README_FILE),
            vec![b'x'; (PROJECT_README_MAX_BYTES + 1) as usize],
        )
        .unwrap();

        let err = read_project_readme(dir.path().to_path_buf()).expect_err("oversized must refuse");
        assert!(err.contains("too large"), "readable error, got: {err}");
    }

    #[test]
    fn errors_readably_on_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PROJECT_README_FILE), [0xff, 0xfe, 0x00]).unwrap();

        let err =
            read_project_readme(dir.path().to_path_buf()).expect_err("invalid UTF-8 must refuse");
        assert!(err.contains("Failed to read"), "readable error, got: {err}");
    }
}
