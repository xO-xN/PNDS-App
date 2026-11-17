//! Project-root README reading (v1.5.0, #125).
//!
//! The optional, author-written document the main area renders when the
//! project's card is selected. `Ok(None)` means nothing to render — no
//! README, or the project directory itself is gone (preflight owns the
//! real diagnostics when starting); a README that exists but cannot be
//! served (unreadable, invalid UTF-8, oversized) is an explicit,
//! readable error the frontend surfaces as a distinct read-failure
//! state, never as the "no README" empty state.
//!
//! Language variants (user report after #127): a project may ship
//! localized READMEs as `README.<locale>.md` (e.g. `README.zh-CN.md`)
//! beside the plain `README.md`. The read takes the App's resolved UI
//! locale and prefers its variant, falling back to the plain file —
//! single-README projects behave exactly as before.

use std::path::{Path, PathBuf};

/// The project-root README filename the main area reads.
pub const PROJECT_README_FILE: &str = "README.md";

/// Hard cap on a README the renderer will accept — a project README
/// beyond this is refused with a readable error instead of janking the
/// main-area webview on megabytes of markdown.
const PROJECT_README_MAX_BYTES: u64 = 512 * 1024;

#[derive(Default)]
pub(crate) struct ParticipationReadmes {
    default: Option<String>,
    english: Option<String>,
    chinese: Option<String>,
}

impl ParticipationReadmes {
    /// Snapshot the saved introductions of one participating run. Remote
    /// requests never name a filesystem path or follow a link outside the root.
    pub(crate) fn capture(root: &Path) -> Self {
        let Ok(root) = super::contained_read::ReadRoot::new(root) else {
            return Self::default();
        };
        let read = |name| {
            use std::io::Read as _;
            let file = root.open(name, "Participation README").ok()?;
            let metadata = file.metadata().ok()?;
            if !metadata.is_file() || metadata.len() > PROJECT_README_MAX_BYTES {
                return None;
            }
            let mut markdown = String::new();
            file.take(PROJECT_README_MAX_BYTES + 1)
                .read_to_string(&mut markdown)
                .ok()?;
            (markdown.len() as u64 <= PROJECT_README_MAX_BYTES).then_some(markdown)
        };
        Self {
            default: read(PROJECT_README_FILE),
            english: read("README.en.md"),
            chinese: read("README.zh-CN.md"),
        }
    }

    pub(crate) fn for_locale(&self, locale: &str) -> Option<&str> {
        let localized = match locale {
            "en" => self.english.as_deref(),
            "zh-CN" => self.chinese.as_deref(),
            _ => None,
        };
        localized.or(self.default.as_deref())
    }
}

/// Reads a project's README for the display routing: the `README.<locale>.md`
/// variant when it exists, else the plain `README.md`. `locale` is the
/// App's resolved UI language tag (`zh-CN`, `en`, …) — blank/None skips
/// straight to the plain file.
pub fn read_project_readme(root: PathBuf, locale: Option<&str>) -> Result<Option<String>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let tag = locale.unwrap_or_default().trim();
    if !tag.is_empty() {
        let variant = root.join(format!("README.{tag}.md"));
        if let Some(body) = read_readme_candidate(&variant)? {
            return Ok(Some(body));
        }
    }
    read_readme_candidate(&root.join(PROJECT_README_FILE))
}

/// One README candidate: `Ok(None)` when it does not exist (or is not a
/// file — a directory named like a README is simply not one); a present
/// candidate must be readable and within the size cap.
fn read_readme_candidate(readme: &std::path::Path) -> Result<Option<String>, String> {
    let metadata = match std::fs::metadata(readme) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to stat {}: {e}", readme.display())),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > PROJECT_README_MAX_BYTES {
        return Err(format!(
            "{} is too large to render ({} bytes; the cap is {})",
            readme.display(),
            metadata.len(),
            PROJECT_README_MAX_BYTES
        ));
    }
    std::fs::read_to_string(readme)
        .map(Some)
        .map_err(|e| format!("Failed to read {}: {e}", readme.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn participation_only_captures_saved_contained_readmes() {
        let dir = tempfile::tempdir().unwrap();
        let external = tempfile::NamedTempFile::new().unwrap();
        fs::write(external.path(), "outside").unwrap();
        fs::write(dir.path().join(PROJECT_README_FILE), "plain").unwrap();
        fs::write(dir.path().join("README.zh-CN.md"), "中文").unwrap();
        std::os::unix::fs::symlink(external.path(), dir.path().join("README.en.md")).unwrap();
        let published = ParticipationReadmes::capture(dir.path());
        assert_eq!(published.for_locale("en"), Some("plain"));
        assert_eq!(published.for_locale("zh-CN"), Some("中文"));
        assert_eq!(published.for_locale("../../private"), Some("plain"));
        fs::write(dir.path().join("README.zh-CN.md"), "later draft").unwrap();
        assert_eq!(published.for_locale("zh-CN"), Some("中文"));
    }

    /// #125: the read contract behind the main area's project README
    /// routing — missing pieces are the empty state (None), a present
    /// README round-trips verbatim, and unreadable ones error readably
    /// instead of half-rendering.
    #[test]
    fn reads_missing_pieces_as_none() {
        // No directory at all (a stale index entry on a moved project).
        assert_eq!(
            read_project_readme(PathBuf::from("/nonexistent/project"), None),
            Ok(None)
        );

        // A directory without a README.md.
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_project_readme(dir.path().to_path_buf(), None),
            Ok(None)
        );

        // A directory where README.md is itself a directory.
        std::fs::create_dir(dir.path().join(PROJECT_README_FILE)).unwrap();
        assert_eq!(
            read_project_readme(dir.path().to_path_buf(), None),
            Ok(None)
        );
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
            read_project_readme(dir.path().to_path_buf(), None),
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

        let err =
            read_project_readme(dir.path().to_path_buf(), None).expect_err("oversized must refuse");
        assert!(err.contains("too large"), "readable error, got: {err}");
    }

    #[test]
    fn errors_readably_on_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PROJECT_README_FILE), [0xff, 0xfe, 0x00]).unwrap();

        let err = read_project_readme(dir.path().to_path_buf(), None)
            .expect_err("invalid UTF-8 must refuse");
        assert!(err.contains("Failed to read"), "readable error, got: {err}");
    }

    /// User report after #127: a project with localized READMEs serves
    /// the App locale's variant; without one the plain README.md is the
    /// answer — bilingual and single-README projects both behave right.
    #[test]
    fn prefers_the_locale_variant_and_falls_back_to_the_plain_readme() {
        let parent = tempfile::tempdir().unwrap();

        // Both variants: the locale's wins.
        let bilingual = parent.path().join("Bilingual");
        fs::create_dir_all(&bilingual).unwrap();
        fs::write(bilingual.join("README.md"), "# English").unwrap();
        fs::write(bilingual.join("README.zh-CN.md"), "# 中文").unwrap();
        assert_eq!(
            read_project_readme(bilingual.clone(), Some("zh-CN")),
            Ok(Some("# 中文".to_string()))
        );
        assert_eq!(
            read_project_readme(bilingual, Some("en")),
            Ok(Some("# English".to_string()))
        );

        // Plain only: every locale falls back to it.
        let plain = parent.path().join("Plain");
        fs::create_dir_all(&plain).unwrap();
        fs::write(plain.join("README.md"), "# English").unwrap();
        assert_eq!(
            read_project_readme(plain.clone(), Some("zh-CN")),
            Ok(Some("# English".to_string()))
        );
        assert_eq!(
            read_project_readme(plain, None),
            Ok(Some("# English".to_string()))
        );

        // Variant only, locale does not match: nothing to render.
        let variant_only = parent.path().join("VariantOnly");
        fs::create_dir_all(&variant_only).unwrap();
        fs::write(variant_only.join("README.zh-CN.md"), "# 中文").unwrap();
        assert_eq!(
            read_project_readme(variant_only.clone(), Some("en")),
            Ok(None)
        );

        // Blank/whitespace locale skips the variant probe entirely.
        let blank = parent.path().join("Blank");
        fs::create_dir_all(&blank).unwrap();
        fs::write(blank.join("README.md"), "# English").unwrap();
        fs::write(blank.join("README.  .md"), "# weird").unwrap();
        assert_eq!(
            read_project_readme(blank, Some("   ")),
            Ok(Some("# English".to_string()))
        );
    }

    /// The variant is a README like any other: the size cap and the
    /// readable errors name the file that failed.
    #[test]
    fn applies_the_size_cap_to_the_locale_variant() {
        let parent = tempfile::tempdir().unwrap();
        let dir = parent.path().join("Big");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("README.md"), "# English").unwrap();
        fs::write(
            dir.join("README.zh-CN.md"),
            vec![b'x'; (PROJECT_README_MAX_BYTES + 1) as usize],
        )
        .unwrap();

        let err = read_project_readme(dir, Some("zh-CN")).expect_err("oversized must refuse");
        assert!(err.contains("README.zh-CN.md"), "names the variant: {err}");
    }
}
