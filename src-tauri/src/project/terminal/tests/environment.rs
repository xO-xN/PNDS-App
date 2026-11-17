use super::{read_until, workspace};
use crate::project::creation::Protection;
use crate::project::terminal::ProjectTerminalManager;
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Stdio};

#[test]
fn project_terminal_replaces_outer_identity_and_preserves_external_rex_access() {
    const CHILD: &str = "PNDS_TERMINAL_ENVIRONMENT_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        // Inject the host's environment in a separate test process so parallel
        // tests never observe a process-wide environment mutation.
        let temporary = tempfile::tempdir().unwrap();
        let bin = temporary.path().join("external rex bin");
        std::fs::create_dir(&bin).unwrap();
        let rex = bin.join("rex");
        std::fs::write(
            &rex,
            "#!/bin/sh\nprintf '\\nEXTERNAL_REX=%s|%s|%s|%s|%s\\n' \"$REX_SERVER\" \"$REX_CONFIG\" \"$REX_BIN_DIR\" \"$1\" \"$2\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&rex, std::fs::Permissions::from_mode(0o755)).unwrap();
        let config = temporary.path().join("rex.lua");
        std::fs::write(&config, "-- external Rex configuration\n").unwrap();
        let mut path = bin.as_os_str().to_os_string();
        path.push(":");
        path.push(std::env::var_os("PATH").unwrap_or_default());
        let test = concat!(
            module_path!(),
            "::project_terminal_replaces_outer_identity_and_preserves_external_rex_access"
        );
        let (_, test) = test.split_once("::").unwrap();
        for inherited_identity in [true, false] {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args(["--exact", test, "--nocapture"])
                .env(CHILD, "1")
                .env("PATH", &path)
                .env("REX_SERVER", "unix:///external-rex-fixture.sock")
                .env("REX_CONFIG", &config)
                .env("REX_BIN_DIR", &bin);
            for (key, value) in [
                ("REX_SESSION", "session:outer-terminal"),
                ("REX_BLOCK", "block:outer-terminal"),
                ("TERM_SESSION_ID", "outer-terminal-session"),
                ("TERM_PROGRAM", "rex"),
                ("TERM_PROGRAM_VERSION", "outer-terminal-version"),
            ] {
                if inherited_identity {
                    command.env(key, value);
                } else {
                    command.env_remove(key);
                }
            }
            // Fence fork/exec against the existing listener-release checks.
            let child = crate::project::children::with_managed_child_pids(|_| {
                command
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
            })
            .unwrap();
            let output = child.wait_with_output().unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "inherited_identity={inherited_identity}\n{stdout}\n{stderr}"
            );
        }
        return;
    }

    let (temporary, access, identity) = workspace();
    let manager = ProjectTerminalManager::new(temporary.path().join("app-data"));
    let session = manager
        .open(&access, &identity, &Protection::default(), 80, 24)
        .unwrap();
    manager
        .write(
            &identity,
            &session.id,
            concat!(
                "stty -echo; printf '\\nHOST=%s\\nHOST_VERSION=%s\\n",
                "OUTER_REX_SESSION=%s\\nOUTER_REX_BLOCK=%s\\nOUTER_TERM_SESSION=%s\\n",
                "TERM_TYPE=%s\\nCOLOR_TYPE=%s\\nHOME_PATH=%s\\n' ",
                "\"$TERM_PROGRAM\" \"$TERM_PROGRAM_VERSION\" \"$REX_SESSION\" ",
                "\"$REX_BLOCK\" \"$TERM_SESSION_ID\" \"$TERM\" \"$COLORTERM\" \"$HOME\"; ",
                "rex -s session:explicit-target; printf '\\nENVIRONMENT_%s\\n' DONE\r"
            )
            .as_bytes(),
        )
        .unwrap();
    let output = read_until(&manager, &identity, &session.id, "ENVIRONMENT_DONE\r\n");
    manager.close(&identity, &session.id).unwrap();
    for expected in [
        "HOST=pnds".to_owned(),
        format!("HOST_VERSION={}", env!("CARGO_PKG_VERSION")),
        "OUTER_REX_SESSION=".to_owned(),
        "OUTER_REX_BLOCK=".to_owned(),
        "OUTER_TERM_SESSION=".to_owned(),
        "TERM_TYPE=xterm-256color".to_owned(),
        "COLOR_TYPE=truecolor".to_owned(),
        format!("HOME_PATH={}", std::env::var("HOME").unwrap()),
        format!(
            "EXTERNAL_REX={}|{}|{}|-s|session:explicit-target",
            std::env::var("REX_SERVER").unwrap(),
            std::env::var("REX_CONFIG").unwrap(),
            std::env::var("REX_BIN_DIR").unwrap()
        ),
    ] {
        assert!(
            output.lines().any(|line| line == expected),
            "missing {expected:?} in PTY output:\n{output}"
        );
    }
}
