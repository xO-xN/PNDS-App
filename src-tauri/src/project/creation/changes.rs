use super::*;

/// One successfully written existing text file. Content is retained only in
/// memory and never relies on Git; identity and disk version guard restoration.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationFileChange {
    pub id: String,
    pub path: String,
    pub before_text: String,
    pub after_text: String,
    pub before_version: String,
    pub after_version: String,
}

impl CreationAccess {
    pub fn save_change(
        &mut self,
        identity: &str,
        path: &str,
        text: &str,
        expected_version: &str,
        protection: &Protection,
    ) -> Result<CreationFileChange, CreationError> {
        let CreationContent::Text {
            text: before_text,
            version: before_version,
        } = self.read(identity, path, protection)?
        else {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "Only existing text files can be changed",
            ));
        };
        if before_version != expected_version {
            return Err(CreationError::new(CreationErrorCode::VersionConflict, path));
        }
        if before_text == text {
            return Err(CreationError::new(
                CreationErrorCode::InvalidProject,
                "The text has not changed",
            ));
        }
        let after_version = self.save(identity, path, text, expected_version, protection)?;
        self.change_sequence += 1;
        let change = CreationFileChange {
            id: format!("{identity}:{}", self.change_sequence),
            path: path.into(),
            before_text,
            after_text: text.into(),
            before_version,
            after_version,
        };
        self.last_change = Some((identity.into(), change.clone()));
        Ok(change)
    }

    pub fn undo_change(
        &mut self,
        identity: &str,
        change_id: &str,
        protection: &Protection,
    ) -> Result<CreationContent, CreationError> {
        self.current(identity, protection)?;
        let change = self
            .last_change
            .as_ref()
            .filter(|(owner, change)| owner == identity && change.id == change_id)
            .map(|(_, change)| change.clone())
            .ok_or_else(|| {
                CreationError::new(
                    CreationErrorCode::VersionConflict,
                    "The saved change is no longer current",
                )
            })?;
        let version = self.save(
            identity,
            &change.path,
            &change.before_text,
            &change.after_version,
            protection,
        )?;
        Ok(CreationContent::Text {
            text: change.before_text,
            version,
        })
    }
}
