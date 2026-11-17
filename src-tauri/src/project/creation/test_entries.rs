//! Supported test-entry discovery is independent of assistant text admission.
use super::*;

impl CreationAccess {
    pub(crate) fn has_node_test_entries(
        &self,
        identity: &str,
        protection: &Protection,
    ) -> Result<bool, CreationError> {
        let project = self.current(identity, protection)?;
        for file in self.list(identity, protection)? {
            if !super::super::controlled_checks::supported_node_test_path(&file.path)
                || assistant::excluded(&file.path).is_some()
            {
                continue;
            }
            let resolved = project.resolve(&file.path)?;
            let actual = resolved
                .strip_prefix(&project.root)
                .expect("contained")
                .to_string_lossy();
            if assistant::excluded(&actual).is_none()
                && file_kind(&actual) == CreationFileKind::Text
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn test_entry_discovery_survives_large_and_numerous_earlier_archives() {
        for (name, count, bytes) in [("large", 2, 1024 * 1024), ("numerous", 257, 8)] {
            let temp = tempfile::tempdir().unwrap();
            let root = super::super::tests::project(temp.path(), name);
            let history = root.join("docs/handoff-history");
            fs::create_dir_all(&history).unwrap();
            for index in 0..count {
                fs::write(history.join(format!("{index:03}.md")), "x".repeat(bytes)).unwrap();
            }
            fs::create_dir(root.join("test")).unwrap();
            fs::write(root.join("test/score.test.js"), "// actual saved test").unwrap();
            let protection = Protection::default();
            let mut access = CreationAccess::default();
            let identity = access.open(&root, &protection).unwrap().project.identity;
            assert!(
                access
                    .has_node_test_entries(&identity, &protection)
                    .unwrap(),
                "{name} archives must not hide a saved Node test entry"
            );
        }
    }

    #[test]
    fn test_entry_discovery_uses_saved_metadata_without_reading_the_test_body() {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::tests::project(temp.path(), "large-test");
        fs::write(
            root.join("score.test.mjs"),
            "x".repeat(TEXT_MAX_BYTES as usize + 1),
        )
        .unwrap();
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        assert!(access
            .has_node_test_entries(&identity, &protection)
            .unwrap());
    }

    #[test]
    fn test_entry_discovery_keeps_excluded_aliases_and_private_data_out() {
        let temp = tempfile::tempdir().unwrap();
        let root = super::super::tests::project(temp.path(), "excluded-tests");
        for path in ["node_modules", "dist", ".ssh", ".git", ".pnds-creation"] {
            fs::create_dir(root.join(path)).unwrap();
            fs::write(root.join(path).join("private.test.js"), "// excluded test").unwrap();
        }
        symlink(".ssh/private.test.js", root.join("sensitive.test.js")).unwrap();
        symlink("dist/private.test.js", root.join("built.test.js")).unwrap();
        symlink(
            "node_modules/private.test.js",
            root.join("dependency.test.js"),
        )
        .unwrap();
        fs::write(root.join("opaque.bin"), "// not saved project text").unwrap();
        symlink("opaque.bin", root.join("binary.test.js")).unwrap();
        let protection = Protection::default();
        let mut access = CreationAccess::default();
        let identity = access.open(&root, &protection).unwrap().project.identity;
        assert!(!access
            .has_node_test_entries(&identity, &protection)
            .unwrap());
        assert_eq!(
            access
                .has_node_test_entries("stale-workspace", &protection)
                .unwrap_err()
                .code,
            CreationErrorCode::InvalidIdentity
        );
    }
}
