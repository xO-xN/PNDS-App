//! PNDS project `manifest.json` parsing and validation.
//!
//! Implements the schemaVersion 1 contract from
//! `docs/PNDS_APP_REQUIREMENTS.md` §5. All user-facing error strings are
//! English (the V1 UI is English-only).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::path::{Component, Path, PathBuf};

/// Audio mode names defined by the V1 contract (§6.1).
const VALID_MODES: [&str; 3] = ["internal", "external", "none"];

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub score_server: ScoreServer,
    pub audio: AudioConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScoreServer {
    pub entry: String,
    pub working_directory: String,
    pub performer_port: u16,
    pub monitor_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub default_mode: String,
    pub supported_modes: Vec<String>,
    /// Discrete project output signals (spec §3.3): 1..=64, default 2.
    /// Not a speaker layout — the App never downmixes.
    #[serde(default = "default_output_channels")]
    pub output_channels: u32,
    pub synthdefs: Option<Vec<String>>,
    pub scsynth: Option<ScsynthConfig>,
    /// Debug-only fallback for standalone runs. The App must never use it;
    /// internal mode OSC targets are always dynamically assigned (§5.2).
    pub standalone_target: Option<String>,
}

/// spec §3.3: `audio.outputChannels` defaults to 2 when omitted.
fn default_output_channels() -> u32 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScsynthConfig {
    /// Issue #20: legacy field, read and ignored. The App's global
    /// sample-rate preference is the sole boot authority; manifests no
    /// longer declare `sampleRate` and validation never requires it. Kept
    /// on the struct (with a placeholder default) so manifests that still
    /// carry it — existing works, bundled .pnds — load losslessly.
    #[serde(default = "default_scsynth_sample_rate")]
    pub sample_rate: u32,
    pub block_size: u32,
    pub audio_bus_channels: u32,
}

/// Issue #20: placeholder for manifests that omit the legacy `sampleRate`;
/// never authoritative (see [`ScsynthConfig::sample_rate`]).
fn default_scsynth_sample_rate() -> u32 {
    crate::types::DEFAULT_SAMPLE_RATE
}

/// Loads and fully validates the manifest of the project at `project_root`.
pub fn load_manifest(project_root: &Path) -> Result<Manifest, String> {
    let manifest = load_manifest_lenient(project_root)?;
    validate_paths(&manifest, project_root)?;
    Ok(manifest)
}

/// Loads and validates the manifest schema without the filesystem checks
/// of [`load_manifest`]. Used by the SynthDef compile runner (issue #17),
/// whose whole purpose is to (re)create the `audio.synthdefs` artifacts
/// whose absence `load_manifest` would reject.
pub fn load_manifest_lenient(project_root: &Path) -> Result<Manifest, String> {
    let path = project_root.join("manifest.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| format!("manifest.json not found or unreadable: {}", path.display()))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    validate_schema(&value)?;
    serde_json::from_value(value)
        .map_err(|e| format!("manifest.json does not match the schema: {e}"))
}

/// Returns true if a dotted field path exists and is not null.
fn field_present(mut cur: &Value, path: &str) -> bool {
    for part in path.split('.') {
        match cur.get(part) {
            Some(next) => cur = next,
            None => return false,
        }
    }
    !cur.is_null()
}

fn get<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = value;
    for part in path.split('.') {
        cur = cur.get(part)?;
    }
    Some(cur)
}

/// Schema-level validation with friendly, field-specific errors (§5.2).
fn validate_schema(value: &Value) -> Result<(), String> {
    // §5.4: the schema version gate runs before anything else.
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(1) => {}
        _ => {
            return Err(
                "Unsupported schema version: manifest.json must declare \"schemaVersion\": 1"
                    .to_string(),
            );
        }
    }

    const REQUIRED: [&str; 9] = [
        "id",
        "name",
        "version",
        "scoreServer.entry",
        "scoreServer.workingDirectory",
        "scoreServer.performerPort",
        "scoreServer.monitorPort",
        "audio.defaultMode",
        "audio.supportedModes",
    ];
    for field in REQUIRED {
        if !field_present(value, field) {
            return Err(format!("manifest.json missing required field: {field}"));
        }
    }

    // Ports: positive integers within u16 range, and distinct.
    let mut ports = [0u64; 2];
    for (i, field) in ["scoreServer.performerPort", "scoreServer.monitorPort"]
        .iter()
        .enumerate()
    {
        match get(value, field).and_then(Value::as_u64) {
            Some(p) if (1..=65535).contains(&p) => ports[i] = p,
            _ => return Err(format!("{field} must be an integer between 1 and 65535")),
        }
    }
    if ports[0] == ports[1] {
        return Err(
            "scoreServer.performerPort and scoreServer.monitorPort must differ".to_string(),
        );
    }

    // Audio modes.
    let modes: Vec<&str> = match get(value, "audio.supportedModes").and_then(Value::as_array) {
        Some(arr) if !arr.is_empty() => arr.iter().filter_map(Value::as_str).collect(),
        _ => {
            return Err("audio.supportedModes must be a non-empty array of mode names".to_string());
        }
    };
    if modes.len()
        != get(value, "audio.supportedModes").map_or(0, |v| v.as_array().map_or(0, |a| a.len()))
    {
        return Err("audio.supportedModes must contain only strings".to_string());
    }
    for mode in &modes {
        if !VALID_MODES.contains(mode) {
            return Err(format!(
                "audio.supportedModes contains an unknown mode: \"{mode}\" (expected one of: internal, external, none)"
            ));
        }
    }
    let default_mode = get(value, "audio.defaultMode")
        .and_then(Value::as_str)
        .ok_or("audio.defaultMode must be a string")?;
    if !modes.contains(&default_mode) {
        return Err(format!(
            "audio.defaultMode \"{default_mode}\" is not listed in audio.supportedModes"
        ));
    }

    // spec §3.3: optional, integer 1..=64, default 2.
    let output_channels = match get(value, "audio.outputChannels") {
        None | Some(Value::Null) => 2u64,
        Some(v) => match v.as_u64() {
            Some(n) if (1..=64).contains(&n) => n,
            _ => {
                return Err(format!(
                    "audio.outputChannels must be an integer between 1 and 64 (declared: {v})"
                ));
            }
        },
    };

    // §5.2 conditional requirements for internal mode.
    if modes.contains(&"internal") {
        match get(value, "audio.synthdefs").and_then(Value::as_array) {
            Some(arr) if !arr.is_empty() && arr.iter().all(|v| v.as_str().is_some()) => {}
            _ => {
                return Err(
                    "audio.synthdefs is required (non-empty array of paths) when \"internal\" is supported"
                        .to_string(),
                );
            }
        }
        // Issue #20: `audio.scsynth.sampleRate` is no longer required (the
        // App's global sample-rate setting owns the boot rate); a legacy
        // value still present in the manifest is read and ignored below.
        for field in ["audio.scsynth.blockSize", "audio.scsynth.audioBusChannels"] {
            match get(value, field).and_then(Value::as_u64) {
                Some(n) if n > 0 => {}
                _ => {
                    return Err(format!(
                        "{field} is required (positive integer) for internal mode"
                    ))
                }
            }
        }

        // spec §3.4: bus capacity must cover hardware buses plus the N
        // private project buses.
        let bus_channels = get(value, "audio.scsynth.audioBusChannels")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let required = 2 * output_channels;
        if bus_channels < required {
            return Err(format!(
                "audio.scsynth.audioBusChannels ({bus_channels}) is too small for audio.outputChannels ({output_channels}): at least {required} (2 × outputChannels) is required"
            ));
        }
    }

    Ok(())
}

/// Resolves a manifest-relative path, enforcing §5.4: relative only, no
/// escape, and the real (symlink-resolved) path must stay inside the project.
fn resolve_within(
    root: &Path,
    canonical_root: &Path,
    rel: &str,
    field: &str,
) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("{field} must be a relative path: \"{rel}\""));
    }
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(format!(
            "{field} must not escape the project directory: \"{rel}\""
        ));
    }
    let joined = root.join(rel_path);
    let canonical = joined
        .canonicalize()
        .map_err(|_| format!("{field} not found: {}", joined.display()))?;
    if !canonical.starts_with(canonical_root) {
        return Err(format!(
            "{field} points outside the project directory: \"{rel}\""
        ));
    }
    Ok(canonical)
}

/// Filesystem-level validation (§5.4).
fn validate_paths(manifest: &Manifest, root: &Path) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project directory: {e}"))?;

    let entry = resolve_within(
        root,
        &canonical_root,
        &manifest.score_server.entry,
        "scoreServer.entry",
    )?;
    if !entry.is_file() {
        return Err("scoreServer.entry is not a file".to_string());
    }

    let working_dir = resolve_within(
        root,
        &canonical_root,
        &manifest.score_server.working_directory,
        "scoreServer.workingDirectory",
    )?;
    if !working_dir.is_dir() {
        return Err("scoreServer.workingDirectory is not a directory".to_string());
    }

    if manifest
        .audio
        .supported_modes
        .iter()
        .any(|m| m == "internal")
    {
        for synthdef in manifest.audio.synthdefs.as_deref().unwrap_or(&[]) {
            let path = resolve_within(root, &canonical_root, synthdef, "audio.synthdefs[]")?;
            if !path.is_file() {
                return Err(format!(
                    "audio.synthdefs entry is not a file: \"{synthdef}\""
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// The shipped `utilities/Multichannel Signal Generator` utility project
    /// must keep passing the App parser and preflight (§11: bundled
    /// verification project contract).
    #[test]
    fn tone_test_example_passes_app_parser() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../utilities/Multichannel Signal Generator");
        let manifest = load_manifest(&root).unwrap();
        assert_eq!(manifest.audio.output_channels, 16);
        assert_eq!(manifest.audio.supported_modes, vec!["internal"]);
        assert!(manifest.audio.scsynth.as_ref().unwrap().audio_bus_channels >= 32);
        // One production dependency (qrcode, monitor QR endpoint) -> the
        // preflight requires node_modules present (spec §2).
        crate::project::preflight::check_dependencies(&root).unwrap();
        // (Port availability is checked at session start, not here: a
        // running PNDS App legitimately occupies the example ports.)
    }

    /// Writes a valid §5.1 manifest plus the files it references.
    fn write_valid_project(dir: &Path) {
        fs::create_dir_all(dir.join("supercollider/synthdefs")).unwrap();
        fs::write(dir.join("server.js"), "// score server").unwrap();
        fs::write(
            dir.join("supercollider/synthdefs/inarticulate-iii.scsyndef"),
            b"SCgf",
        )
        .unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "id": "inarticulate-iii",
              "name": "Inarticulate III",
              "version": "0.1.0",
              "scoreServer": {
                "entry": "server.js",
                "workingDirectory": ".",
                "performerPort": 6868,
                "monitorPort": 6869
              },
              "audio": {
                "defaultMode": "internal",
                "supportedModes": ["internal", "external", "none"],
                "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
                "scsynth": { "sampleRate": 48000, "blockSize": 64, "audioBusChannels": 128 },
                "standaloneTarget": "127.0.0.1:57110"
              }
            }"#,
        )
        .unwrap();
    }

    fn write_manifest(dir: &Path, body: &str) {
        fs::write(dir.join("manifest.json"), body).unwrap();
    }

    #[test]
    fn valid_manifest_loads() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        let manifest = load_manifest(dir.path()).unwrap();
        assert_eq!(manifest.id, "inarticulate-iii");
        assert_eq!(manifest.score_server.performer_port, 6868);
        assert_eq!(manifest.audio.scsynth.as_ref().unwrap().sample_rate, 48000);
    }

    #[test]
    fn missing_manifest_is_readable_error() {
        let dir = tempfile::tempdir().unwrap();
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("manifest.json not found"), "unexpected: {err}");
    }

    #[test]
    fn invalid_json_is_readable_error() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(dir.path(), "{ not json");
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("not valid JSON"), "unexpected: {err}");
    }

    #[test]
    fn wrong_schema_version_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(dir.path(), r#"{ "schemaVersion": 2 }"#);
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(
            err.contains("Unsupported schema version"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn missing_required_field_named() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868 },
              "audio": { "defaultMode": "none", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("scoreServer.monitorPort"), "unexpected: {err}");
    }

    #[test]
    fn default_mode_must_be_supported() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "internal", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("defaultMode"), "unexpected: {err}");
    }

    #[test]
    fn internal_requires_synthdefs_and_scsynth_params() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        // Missing synthdefs
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "internal", "supportedModes": ["internal"],
                "scsynth": { "sampleRate": 48000, "blockSize": 64, "audioBusChannels": 128 } }
            }"#,
        );
        assert!(load_manifest(dir.path()).unwrap_err().contains("synthdefs"));

        // Missing scsynth.blockSize
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "internal", "supportedModes": ["internal"],
                "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
                "scsynth": { "sampleRate": 48000, "audioBusChannels": 128 } }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("blockSize"), "unexpected: {err}");
    }

    /// Issue #20: `audio.scsynth.sampleRate` is no longer part of the
    /// schema's live surface — an internal manifest validates with the
    /// field absent (placeholder fills in) and with a legacy value present
    /// (read and ignored, never a rejection, never used for boot).
    #[test]
    fn internal_manifest_validates_with_and_without_sample_rate() {
        for (declared, parsed) in [(None, 48_000), (Some(96_000u32), 96_000)] {
            let dir = tempfile::tempdir().unwrap();
            write_valid_project(dir.path());
            let sample_rate_json = declared
                .map(|n| format!("\"sampleRate\": {n}, "))
                .unwrap_or_default();
            write_manifest(
                dir.path(),
                &format!(
                    r#"{{
                      "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
                      "scoreServer": {{ "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }},
                      "audio": {{ "defaultMode": "internal", "supportedModes": ["internal"],
                        "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
                        "scsynth": {{ {sample_rate_json}"blockSize": 64, "audioBusChannels": 128 }} }}
                    }}"#
                ),
            );
            let manifest = load_manifest(dir.path())
                .unwrap_or_else(|e| panic!("declared={declared:?} must validate: {e}"));
            let sc = manifest.audio.scsynth.as_ref().unwrap();
            assert_eq!(sc.sample_rate, parsed, "declared={declared:?}");
            assert_eq!(sc.block_size, 64);
        }
    }

    #[test]
    fn output_channels_defaults_to_two() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        let manifest = load_manifest(dir.path()).unwrap();
        assert_eq!(manifest.audio.output_channels, 2);
    }

    #[test]
    fn output_channels_accepts_1_to_64() {
        for n in [1u32, 2, 16, 64] {
            let dir = tempfile::tempdir().unwrap();
            write_valid_project(dir.path());
            write_manifest(
                dir.path(),
                &format!(
                    r#"{{
                      "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
                      "scoreServer": {{ "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }},
                      "audio": {{ "defaultMode": "none", "supportedModes": ["none"], "outputChannels": {n} }}
                    }}"#
                ),
            );
            let manifest = load_manifest(dir.path()).unwrap();
            assert_eq!(manifest.audio.output_channels, n);
        }
    }

    #[test]
    fn output_channels_rejects_out_of_range_and_non_integers() {
        for declared in ["0", "65", "2.5", "\"16\"", "-1"] {
            let dir = tempfile::tempdir().unwrap();
            write_valid_project(dir.path());
            write_manifest(
                dir.path(),
                &format!(
                    r#"{{
                      "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
                      "scoreServer": {{ "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }},
                      "audio": {{ "defaultMode": "none", "supportedModes": ["none"], "outputChannels": {declared} }}
                    }}"#
                ),
            );
            let err = load_manifest(dir.path()).unwrap_err();
            assert!(err.contains("audio.outputChannels"), "{declared}: {err}");
        }
    }

    #[test]
    fn internal_bus_capacity_must_cover_two_times_output_channels() {
        for (bus, expected_ok) in [(32u32, true), (31, false)] {
            let dir = tempfile::tempdir().unwrap();
            write_valid_project(dir.path());
            write_manifest(
                dir.path(),
                &format!(
                    r#"{{
                      "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
                      "scoreServer": {{ "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 }},
                      "audio": {{ "defaultMode": "internal", "supportedModes": ["internal"],
                        "outputChannels": 16,
                        "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
                        "scsynth": {{ "sampleRate": 48000, "blockSize": 64, "audioBusChannels": {bus} }} }}
                    }}"#
                ),
            );
            let result = load_manifest(dir.path());
            assert_eq!(result.is_ok(), expected_ok, "bus={bus}");
            if let Err(err) = result {
                assert!(err.contains("audio.scsynth.audioBusChannels (31)"), "{err}");
                assert!(err.contains("audio.outputChannels (16)"), "{err}");
                assert!(err.contains("at least 32"), "{err}");
            }
        }
    }

    #[test]
    fn external_only_project_needs_no_synthdefs() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("server.js"), "//").unwrap();
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "external", "supportedModes": ["external", "none"] }
            }"#,
        );
        load_manifest(dir.path()).unwrap();
    }

    #[test]
    fn absolute_entry_path_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "/etc/passwd", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "none", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("relative path"), "unexpected: {err}");
    }

    #[test]
    fn parent_escape_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "../outside.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6869 },
              "audio": { "defaultMode": "none", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("escape"), "unexpected: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_project_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        // Point the synthdef at a file outside the project root.
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(
            outside.path(),
            dir.path()
                .join("supercollider/synthdefs/inarticulate-iii.scsyndef"),
        )
        .unwrap_err(); // target already exists from write_valid_project
        fs::remove_file(
            dir.path()
                .join("supercollider/synthdefs/inarticulate-iii.scsyndef"),
        )
        .unwrap();
        std::os::unix::fs::symlink(
            outside.path(),
            dir.path()
                .join("supercollider/synthdefs/inarticulate-iii.scsyndef"),
        )
        .unwrap();
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("outside the project"), "unexpected: {err}");
    }

    #[test]
    fn missing_entry_file_named() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        fs::remove_file(dir.path().join("server.js")).unwrap();
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(
            err.contains("scoreServer.entry not found"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn equal_ports_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 6868, "monitorPort": 6868 },
              "audio": { "defaultMode": "none", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("must differ"), "unexpected: {err}");
    }

    #[test]
    fn zero_port_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_valid_project(dir.path());
        write_manifest(
            dir.path(),
            r#"{
              "schemaVersion": 1, "id": "x", "name": "X", "version": "0.1.0",
              "scoreServer": { "entry": "server.js", "workingDirectory": ".", "performerPort": 0, "monitorPort": 6869 },
              "audio": { "defaultMode": "none", "supportedModes": ["none"] }
            }"#,
        );
        let err = load_manifest(dir.path()).unwrap_err();
        assert!(err.contains("between 1 and 65535"), "unexpected: {err}");
    }
}
