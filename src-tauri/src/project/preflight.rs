//! Preflight checks: dependency check and port availability.
//! See `docs/zh-CN/reference/runtime-contract.md` §4, §8 and the preflight
//! checklist in `docs/developer/app-behavior.md` (工程选择与历史).
//!
//! The child-process lifecycle (spawn, record, kill escalation, orphan
//! cleanup) has moved to `project/children.rs`.

use std::collections::HashSet;
use std::path::Path;

/// Compliance rule (docs/zh-CN/reference/structure.md): a project with
/// non-empty production dependencies
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
/// v1.2.3 (issue #37): a port whose listeners ALL belong to the live
/// session's own children passes — those sockets are released when that
/// session stops, so preflighting project B while A runs must not read A
/// as a conflict. Attribution is by pid: any holder the live session does
/// not own is still a conflict.
///
/// Detection is layered, because a plain wildcard bind is NOT enough on
/// macOS: Rust's TcpListener sets SO_REUSEADDR, and BSD semantics let a
/// wildcard bind succeed even while another process listens on a specific
/// address of the same port (e.g. 127.0.0.1:6868). The score server then
/// can't actually serve and the session dies as an opaque 30s health
/// timeout instead of a readable conflict. So:
/// 1. lsof LISTEN pids — authoritative, sees every bind address, and
///    agrees with what the settings Ports section reports;
/// 2. wildcard bind — catches listeners lsof couldn't be asked about;
/// 3. loopback bind — catches the specific-address case if lsof failed.
///
/// FORMAT CONTRACT: the ErrorScreen port-conflict linkage (v1.2.0, issue
/// #14) matches this message with `/^Port (\d+) is already in use\./m` to
/// offer [Release and Retry]. The first line's wording is load-bearing;
/// `port_conflict_message_is_parseable` pins it.
pub fn check_ports_available(
    performer_port: u16,
    monitor_port: u16,
    live_session_pids: &HashSet<u32>,
) -> Result<(), String> {
    for port in [performer_port, monitor_port] {
        let listeners = crate::project::ports::listening_pids(port);
        if !listeners.is_empty() {
            if listeners.iter().all(|pid| live_session_pids.contains(pid)) {
                continue; // ours; released when the live session stops
            }
            return Err(port_conflict_message(port));
        }
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_err()
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
        let err = check_ports_available(port, 0, &HashSet::new()).unwrap_err();
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
        let err = check_ports_available(port, 0, &HashSet::new()).unwrap_err();
        assert!(
            err.contains(&format!("Port {port} is already in use")),
            "unexpected: {err}"
        );
    }

    /// v1.2.3 (issue #37): a port held ONLY by the live session's own
    /// children passes — those sockets are released when the session stops,
    /// so preflighting project B while A runs must not read A as a
    /// conflict. This test process plays the session: it binds both
    /// listeners, so lsof attributes them to the test's own pid.
    #[test]
    fn port_held_only_by_the_live_session_passes() {
        let performer = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let monitor = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let live = HashSet::from([std::process::id()]);
        check_ports_available(
            performer.local_addr().unwrap().port(),
            monitor.local_addr().unwrap().port(),
            &live,
        )
        .unwrap();
    }

    /// v1.2.3 (issue #37): the pass rule is attributed by pid. A live
    /// session exists (a real, unrelated pid is exempt) but the listener
    /// belongs to someone else — still the existing conflict error.
    #[test]
    fn port_held_by_a_third_party_still_conflicts_during_a_live_session() {
        let out = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 41 >/dev/null 2>&1 & echo $!"])
            .output()
            .unwrap();
        let session_pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
        let listener = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let err = check_ports_available(port, 0, &HashSet::from([session_pid])).unwrap_err();
        assert!(
            err.contains(&format!("Port {port} is already in use")),
            "unexpected: {err}"
        );

        // The exempt pid was only a fixture; clean it up.
        let _ = std::process::Command::new("/bin/kill")
            .args(["-9", &session_pid.to_string()])
            .status();
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
