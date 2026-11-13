use super::*;
use crate::project::children::{ChildRegistry, SupervisedChild};
use crate::test_support::FixturePorts;
use serde_json::Value;
use std::os::unix::fs::symlink;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const SCORE_NAME: &str = "Nocturne & 潮线";

fn run(command: &mut Command) -> String {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{command:?} failed with {}\n{}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn git(root: &Path, args: &[&str]) -> String {
    run(Command::new("git")
        .current_dir(root)
        .args([
            "-c",
            "user.name=Template Test",
            "-c",
            "user.email=template@example.com",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args))
}

fn commit(root: &Path, message: &str) {
    git(root, &["add", "--all"]);
    git(root, &["commit", "--no-gpg-sign", "-m", message]);
}

fn export_candidate(root: &Path) -> String {
    let tag = blank::github_template::export(root).unwrap();
    assert!(!root.join(".git").exists());
    git(root, &["init", "-b", "main"]);
    commit(root, "Candidate Blank snapshot");
    git(root, &["tag", "--no-sign", &tag]);
    tag
}

fn json(root: &Path, path: &str) -> Value {
    serde_json::from_slice(&fs::read(root.join(path)).unwrap()).unwrap()
}

fn initialize(root: &Path, name: &str) {
    run(Command::new("npm").current_dir(root).args([
        "run",
        "init:pnds",
        "--",
        "--name",
        name,
        "--author",
        "Ada Chen",
        "--description",
        "An evening score.",
    ]));
}

#[test]
fn github_blank_template_exports_a_reproducible_tagged_tree() {
    let temp = tempfile::tempdir().unwrap();
    let candidate = temp.path().join("candidate");
    let tag = export_candidate(&candidate);
    assert_eq!(tag, "pnds-blank-v1.7.0");
    assert_eq!(
        json(&candidate, "docs/template-source.json")["version"],
        "1.7.0"
    );
    assert_eq!(
        json(&candidate, "manifest.json")["id"],
        "pnds-blank-template"
    );
    let readme = fs::read_to_string(candidate.join("README.md")).unwrap();
    let directory =
        "https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories";
    assert!(readme.contains(directory));
    for path in [
        "docs/github-template.en.md",
        "docs/github-template.zh-CN.md",
    ] {
        assert!(readme.contains(path));
        let guide = fs::read_to_string(candidate.join(path)).unwrap();
        assert!(guide.contains(directory));
        assert!(guide.contains("`pnds-project`"));
    }
    assert_eq!(
        blank::github_template::export(&candidate).unwrap_err().code,
        CreationErrorCode::TargetExists
    );
    let tagged_tree = git(&candidate, &["rev-parse", &format!("{tag}^{{tree}}")]);

    let exported_again = temp.path().join("fresh-export");
    assert_eq!(
        blank::github_template::export(&exported_again).unwrap(),
        tag
    );
    git(&exported_again, &["init", "-b", "main"]);
    commit(&exported_again, "Fresh export of the same version");
    assert_eq!(
        git(&exported_again, &["rev-parse", "HEAD^{tree}"]),
        tagged_tree
    );
    fs::write(exported_again.join("public/style.css"), "/* modified */\n").unwrap();
    commit(
        &exported_again,
        "Modify an asset without changing the version",
    );
    assert_ne!(
        git(&exported_again, &["rev-parse", "HEAD^{tree}"]),
        tagged_tree
    );
}

#[test]
fn github_blank_template_initializes_previews_and_opens_the_same_project() {
    let temp = tempfile::tempdir().unwrap();
    let candidate = temp.path().join("candidate");
    let tag = export_candidate(&candidate);
    let tagged_tree = git(&candidate, &["rev-parse", &format!("{tag}^{{tree}}")]);
    let archive = temp.path().join("snapshot.tar");
    run(Command::new("git")
        .current_dir(&candidate)
        .args(["archive", "--output"])
        .arg(&archive)
        .arg(&tag));
    let first = temp.path().join("first/score");
    let second = temp.path().join("second/score");
    for root in [&first, &second] {
        // GitHub's template creation copies a tree into a new repository history.
        fs::create_dir_all(root).unwrap();
        run(Command::new("tar")
            .current_dir(root)
            .arg("-xf")
            .arg(&archive));
        git(root, &["init", "-b", "main"]);
        commit(root, "Initial commit from GitHub template");
        let initial = git(root, &["rev-parse", "HEAD"]);
        assert_eq!(git(root, &["rev-parse", "HEAD^{tree}"]), tagged_tree);
        initialize(root, SCORE_NAME);
        assert_eq!(git(root, &["rev-parse", "HEAD"]), initial);
    }

    let manifest = json(&first, "manifest.json");
    let id = manifest["id"].as_str().unwrap();
    assert_ne!(id, "pnds-blank-template");
    assert_ne!(manifest["id"], json(&second, "manifest.json")["id"]);
    assert_eq!(manifest["name"], SCORE_NAME);
    assert_eq!(manifest["description"], "An evening score.");
    assert_eq!(manifest["audio"]["defaultMode"], "internal");
    let package = json(&first, "package.json");
    assert_eq!(package["name"], id);
    assert_eq!(package["author"], "Ada Chen");
    assert_eq!(package["description"], manifest["description"]);
    assert_eq!(json(&first, "public/pnds-player.json")["projectId"], id);
    assert_eq!(
        fs::read(first.join("docs/template-source.json")).unwrap(),
        fs::read(candidate.join("docs/template-source.json")).unwrap()
    );
    let readme = fs::read_to_string(first.join("README.md")).unwrap();
    for text in [
        "# Nocturne & 潮线",
        "title: Nocturne & 潮线",
        "composer: Ada Chen",
        "An evening score.",
    ] {
        assert!(
            readme.lines().any(|line| line == text),
            "Missing {text} in README"
        );
    }
    commit(&first, "Initialize Nocturne");

    let monitor_page = first.join("public/monitor.html");
    let original = fs::read_to_string(&monitor_page).unwrap();
    fs::write(
        monitor_page,
        format!("{original}\n<!-- Creator's work -->\n"),
    )
    .unwrap();
    git(&first, &["add", "--all"]);
    let edited_tree = git(&first, &["write-tree"]);
    initialize(&first, "Discarded name");
    assert_eq!(git(&first, &["diff", "--name-only"]), "");
    assert_eq!(
        git(&first, &["ls-files", "--others", "--exclude-standard"]),
        ""
    );
    assert_eq!(git(&first, &["write-tree"]), edited_tree);
    assert_eq!(json(&first, "manifest.json")["id"], id);
    commit(&first, "Continue composing");

    let remote = temp.path().join("remote.git");
    run(Command::new("git")
        .args(["init", "--bare", "-b", "main"])
        .arg(&remote));
    git(&first, &["push", remote.to_str().unwrap(), "main"]);
    let protection = Protection::default();
    let url = format!("file://{}", remote.display());
    let (cloned, _) =
        github_git::clone_project(&url, "main", None, temp.path(), "cloned-score", &protection)
            .unwrap();
    assert_eq!(
        git(&cloned, &["rev-list", "HEAD"]),
        git(&first, &["rev-list", "HEAD"])
    );
    assert_eq!(git(&cloned, &["rev-list", "--count", "HEAD"]), "3");
    let libraries = super::tests::shared_libraries();
    crate::project::bundle::validate_packable_with_libraries(&cloned, Some(&libraries)).unwrap();
    let mut access = CreationAccess::default();
    let workspace = access.open(&cloned, &protection).unwrap();
    assert_eq!(workspace.project.name, SCORE_NAME);
    assert_eq!(
        access
            .manifest(&workspace.project.identity, &protection)
            .unwrap()
            .id,
        id
    );

    preview_without_host(&cloned, &libraries, id);
}

fn preview_without_host(root: &Path, libraries: &Path, id: &str) {
    // Use the exact installed dependency fixture offline and resolve it via the
    // project's node_modules, as npm install would for a standalone author.
    symlink(
        libraries.join("node/node_modules"),
        root.join("node_modules"),
    )
    .unwrap();
    let mut ports = FixturePorts::<2>::reserve("github-blank-preview").unwrap();
    let [performer, monitor] = ports.values();
    let mut manifest = json(root, "manifest.json");
    manifest["scoreServer"]["performerPort"] = performer.into();
    manifest["scoreServer"]["monitorPort"] = monitor.into();
    fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();

    let registry = ChildRegistry::new(root.join(".pnds-test-registry"));
    let mut command = Command::new("npm");
    command
        .current_dir(root)
        .args(["start", "--", "--audio-mode", "none"])
        .env_remove("PNDS_SHARED_LIBRARIES")
        .env_remove("PNDS_RUNTIME_PORTS")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    ports.release_for_start();
    let mut child = PreviewProcess(
        SupervisedChild::spawn_group(&registry, "github-blank-preview", &mut command).unwrap(),
    );
    let client = ureq::Agent::config_builder()
        .proxy(None)
        .timeout_global(Some(Duration::from_millis(500)))
        .build()
        .new_agent();
    let deadline = Instant::now() + Duration::from_secs(5);
    for port in [performer, monitor] {
        let health_url = format!("http://127.0.0.1:{port}/__pnds/health");
        let health = loop {
            if let Ok(mut response) = client.get(&health_url).call() {
                let health: Value =
                    serde_json::from_str(&response.body_mut().read_to_string().unwrap()).unwrap();
                if health["status"] == "ready" {
                    break health;
                }
            }
            if let Some(status) = child.0.try_wait().unwrap() {
                let mut error = String::new();
                child
                    .0
                    .child()
                    .stderr
                    .as_mut()
                    .unwrap()
                    .read_to_string(&mut error)
                    .unwrap();
                panic!("Standalone npm preview exited with {status}: {error}");
            }
            assert!(Instant::now() < deadline, "Preview not ready on {port}");
            std::thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(health["projectId"], id);
        assert_eq!(health["audioMode"], "none");
        assert_eq!(health["audio"]["status"], "disabled");
        let page = client
            .get(format!("http://127.0.0.1:{port}/"))
            .call()
            .unwrap()
            .body_mut()
            .read_to_string()
            .unwrap();
        assert!(page.contains("<h1>Nocturne &amp; 潮线</h1>"));
    }
}

struct PreviewProcess(SupervisedChild);

impl Drop for PreviewProcess {
    fn drop(&mut self) {
        self.0.shutdown(Duration::from_secs(3));
    }
}
