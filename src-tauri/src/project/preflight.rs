//! Preflight checks: dependency check and port availability.
//! See `docs/PNDS_APP_REQUIREMENTS.md` §4, §7, §8.2 and
//! `docs/PNDS_SCORE_PROJECT_SPECIFICATION.md` §2.
//!
//! The child-process lifecycle (spawn, record, kill escalation, orphan
//! cleanup) has moved to `project/children.rs`.

use std::path::Path;

/// §4 + spec §2: a project with non-empty production dependencies
/// (`dependencies` or `optionalDependencies`) must ship a usable
/// `node_modules/`. Zero-dependency projects need none. `devDependencies`
/// are irrelevant at runtime, `engines.node` is advisory and never affects
/// the outcome, and the check never runs npm or touches the network.
pub fn check_dependencies(project_root: &Path) -> Result<(), String> {
    let package_json = project_root.join("package.json");
    if !package_json.is_file() {
        return Ok(());
    }

    let body = std::fs::read_to_string(&package_json)
        .map_err(|e| format!("Failed to read {}: {e}", package_json.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("{} is not valid JSON: {e}", package_json.display()))?;

    let mut requires_node_modules = false;
    for field in ["dependencies", "optionalDependencies"] {
        match parsed.get(field) {
            None | Some(serde_json::Value::Null) => {}
            Some(serde_json::Value::Object(entries)) => {
                if !entries.is_empty() {
                    requires_node_modules = true;
                }
            }
            Some(_) => {
                return Err(format!(
                    "{}: \"{field}\" must be an object mapping package names to versions.",
                    package_json.display()
                ));
            }
        }
    }

    if requires_node_modules {
        let node_modules = project_root.join("node_modules");
        if !node_modules.is_dir() {
            return Err(format!(
                "Project dependencies are missing.\nExpected: {}",
                node_modules.display()
            ));
        }
    }
    Ok(())
}

/// §7: both HTTP ports must be free. No auto-rebinding, no manifest edits —
/// a conflict fails preflight with an actionable message.
///
/// Detection is layered, because a plain wildcard bind is NOT enough on
/// macOS: Rust's TcpListener sets SO_REUSEADDR, and BSD semantics let a
/// wildcard bind succeed even while another process listens on a specific
/// address of the same port (e.g. 127.0.0.1:6868). The score server then
/// can't actually serve and the session dies as an opaque 30s health
/// timeout instead of a readable conflict. So:
/// 1. lsof LISTEN check — authoritative, sees every bind address, and
///    agrees with what the settings Ports section reports;
/// 2. wildcard bind — catches listeners lsof couldn't be asked about;
/// 3. loopback bind — catches the specific-address case if lsof failed.
///
/// FORMAT CONTRACT: the ErrorScreen port-conflict linkage (v1.2.0, issue
/// #14) matches this message with `/^Port (\d+) is already in use\./m` to
/// offer [Release and Retry]. The first line's wording is load-bearing;
/// `port_conflict_message_is_parseable` pins it.
pub fn check_ports_available(performer_port: u16, monitor_port: u16) -> Result<(), String> {
    for port in [performer_port, monitor_port] {
        if crate::project::ports::port_has_listener(port)
            || std::net::TcpListener::bind(("0.0.0.0", port)).is_err()
            || std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
        {
            return Err(port_conflict_message(port));
        }
    }
    Ok(())
}

/// The single producer of the port-conflict error string. The guidance
/// line points at the Settings → Ports release (v1.2.0, issue #14) instead
/// of telling the user to run lsof themselves.
pub(crate) fn port_conflict_message(port: u16) -> String {
    format!(
        "Port {port} is already in use.\nOpen Settings → Ports (⌘,) to see who holds it and release the port, then try again."
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_package_json(dir: &Path, body: &str) {
        fs::write(dir.join("package.json"), body).unwrap();
    }

    #[test]
    fn no_package_json_passes_without_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        check_dependencies(dir.path()).unwrap();
    }

    #[test]
    fn empty_production_dependencies_pass() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(
            dir.path(),
            r#"{ "dependencies": {}, "optionalDependencies": {} }"#,
        );
        check_dependencies(dir.path()).unwrap();
    }

    #[test]
    fn dev_dependencies_alone_pass() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(
            dir.path(),
            r#"{ "devDependencies": { "vitest": "^4.0.0" } }"#,
        );
        check_dependencies(dir.path()).unwrap();
    }

    #[test]
    fn non_empty_dependencies_require_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(dir.path(), r#"{ "dependencies": { "ws": "^8.0.0" } }"#);
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(
            err.contains("Project dependencies are missing."),
            "unexpected: {err}"
        );
        assert!(err.contains("node_modules"), "unexpected: {err}");
    }

    #[test]
    fn non_empty_optional_dependencies_require_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(
            dir.path(),
            r#"{ "optionalDependencies": { "fsevents": "^2.3.0" } }"#,
        );
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(
            err.contains("Project dependencies are missing."),
            "unexpected: {err}"
        );
    }

    #[test]
    fn production_dependencies_with_node_modules_pass() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(dir.path(), r#"{ "dependencies": { "ws": "^8.0.0" } }"#);
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        check_dependencies(dir.path()).unwrap();
    }

    #[test]
    fn invalid_package_json_is_diagnosable() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(dir.path(), "{ not json");
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(err.contains("not valid JSON"), "unexpected: {err}");
        assert!(err.contains("package.json"), "unexpected: {err}");
    }

    #[test]
    fn mistyped_dependencies_field_is_diagnosable() {
        let dir = tempfile::tempdir().unwrap();
        write_package_json(dir.path(), r#"{ "dependencies": "ws" }"#);
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(err.contains("\"dependencies\""), "unexpected: {err}");
        assert!(err.contains("package.json"), "unexpected: {err}");
    }

    #[test]
    fn engines_node_never_affects_result() {
        // Missing, compatible, incompatible, and non-standard engines.node
        // values must all yield the same preflight outcome.
        for body in [
            r#"{ "dependencies": {} }"#,
            r#"{ "dependencies": {}, "engines": { "node": ">=24 <25" } }"#,
            r#"{ "dependencies": {}, "engines": { "node": ">=99" } }"#,
            r#"{ "dependencies": {}, "engines": { "node": "banana" } }"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            write_package_json(dir.path(), body);
            check_dependencies(dir.path()).unwrap();
        }
    }

    #[test]
    fn occupied_port_is_reported() {
        let listener = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let err = check_ports_available(port, 0).unwrap_err();
        assert!(
            err.contains(&format!("Port {port} is already in use")),
            "unexpected: {err}"
        );
        // No rebind-after-drop assertion: tests run in parallel, and another
        // test may legitimately grab the freed ephemeral port first (a
        // 127.0.0.1 bind collides with a 0.0.0.0 wildcard bind on macOS).
    }

    /// Regression (found in live testing): a listener bound to a SPECIFIC
    /// address (127.0.0.1) must fail preflight. The wildcard bind used to
    /// succeed over it (SO_REUSEADDR + BSD semantics), the score server
    /// then never actually served, and the session died as an opaque 30s
    /// health timeout instead of a readable port conflict.
    #[test]
    fn loopback_bound_listener_is_reported() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let err = check_ports_available(port, 0).unwrap_err();
        assert!(
            err.contains(&format!("Port {port} is already in use")),
            "unexpected: {err}"
        );
    }

    /// v1.2.0 (issue #14): the ErrorScreen port-conflict linkage parses the
    /// FIRST line with the regex `/^Port (\d+) is already in use\./m` — this
    /// pins the exact shape the frontend depends on. The guidance line must
    /// point at the Settings → Ports release, not manual lsof.
    #[test]
    fn port_conflict_message_is_parseable() {
        let message = port_conflict_message(6868);
        let re = regex_lite_expect(&message);
        assert_eq!(re, Some(6868));
        assert!(
            message.contains("Settings → Ports"),
            "guidance must point at the settings release: {message}"
        );
        assert!(
            !message.contains("lsof"),
            "the user no longer needs to run lsof manually: {message}"
        );
    }

    /// Minimal mirror of the frontend regex — no regex crate dependency.
    fn regex_lite_expect(message: &str) -> Option<u16> {
        let first = message.lines().next()?;
        let rest = first.strip_prefix("Port ")?;
        let number = rest.strip_suffix(" is already in use.")?;
        number.parse().ok()
    }
}
