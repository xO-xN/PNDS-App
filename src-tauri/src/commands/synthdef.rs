//! SynthDef compile command (v1.2.0, issue #17): the settings developer
//! tools' one-click `supercollider/source/*.scd` → `synthdefs/*.scsyndef`
//! runner, using the locally installed SuperCollider's sclang.

use crate::project::synthdef::{self, SynthdefCompileResult};

/// Compiles the project's SynthDef sources and verifies the manifest's
/// artifact references (contract: def name = artifact file name = manifest
/// reference). Fails with the sclang output when compilation fails.
#[tauri::command]
#[specta::specta]
pub async fn compile_project_synthdefs(path: String) -> Result<SynthdefCompileResult, String> {
    synthdef::compile_synthdefs(std::path::Path::new(&path))
}
