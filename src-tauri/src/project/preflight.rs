//! Preflight checks: dependency check and port availability.
//! See `docs/PNDS_APP_REQUIREMENTS.md` §4, §7, §8.2.
//!
//! The child-process lifecycle (spawn, record, kill escalation, orphan
//! cleanup) has moved to `project/children.rs`.

use std::path::Path;

/// §4: the project must ship its installed production dependencies.
pub fn check_dependencies(project_root: &Path) -> Result<(), String> {
    let node_modules = project_root.join("node_modules");
    if !node_modules.is_dir() {
        return Err(format!(
            "Project dependencies are missing.\nExpected: {}",
            node_modules.display()
        ));
    }
    Ok(())
}

/// §7: both HTTP ports must be free. No auto-rebinding, no manifest edits —
/// a conflict fails preflight with an actionable message.
pub fn check_ports_available(performer_port: u16, monitor_port: u16) -> Result<(), String> {
    for port in [performer_port, monitor_port] {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_err() {
            return Err(format!(
                "Port {port} is already in use.\nClose the application using it (find it with: lsof -i :{port}) and try again."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dependencies_missing_uses_contract_wording() {
        let dir = tempfile::tempdir().unwrap();
        let err = check_dependencies(dir.path()).unwrap_err();
        assert!(
            err.contains("Project dependencies are missing."),
            "unexpected: {err}"
        );
        assert!(err.contains("node_modules"), "unexpected: {err}");
    }

    #[test]
    fn dependencies_present_passes() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        check_dependencies(dir.path()).unwrap();
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
}
