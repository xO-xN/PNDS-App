//! Help-center corpus loading (v1.3.0, issue #53; zh-CN tree move, #66;
//! bilingual mirror trees, #67).
//!
//! The help corpus ships in the app resources as RAW markdown from two
//! isomorphic language trees — `docs/zh-CN/*.md` and `docs/en/*.md` in
//! the repository are the only sources, copied verbatim by the bundler
//! (tauri.conf.json maps each file into `help/<tree>/…`) with no
//! build-time conversion: the help window renders markdown at runtime
//! and builds its search index in memory (#53's decision, superseding
//! the spec's original build-time HTML+index plan). developer/ and
//! agents/ docs are deliberately NOT in this list.
//!
//! Dev builds read the repository's language trees directly (edits are
//! live in `tauri dev`); release builds read the bundled copies. The id
//! list is the stable contract with the frontend manifest
//! (src/lib/help-corpus.ts) — both sides fail loudly on drift — and the
//! trees themselves are pinned by the drift tests below (ADR-0001: a
//! missing translation on either side fails the build, never a silent
//! fallback to the other language).
//!
//! #68: the command takes the resolved UI locale (`en` / `zh-CN`) and
//! serves that locale's tree. An unknown locale or an unreadable
//! document is an explicit error — the help center never silently
//! falls back to the other language.

use std::path::PathBuf;

use specta::Type;
use tauri::{AppHandle, Manager};

/// Where the language trees live in a repository checkout, relative to
/// the src-tauri/ crate directory.
const DOCS_ROOT: &str = "../docs";

/// The language trees the corpus ships in (ADR-0001), as directory
/// names under docs/ — and, in a release bundle, under help/. The
/// trees are isomorphic: one (id, path) list serves every tree. The
/// names double as the locales the `help_corpus` command accepts.
const HELP_TREES: &[&str] = &["zh-CN", "en"];

/// One help document exactly as the frontend receives it: its stable id,
/// its language-tree-relative path (the base the help window resolves
/// the corpus's cross-document markdown links against — #56 user
/// report), and the raw markdown. Titles and sections are the
/// frontend's to derive (it owns the markdown structure pass).
#[derive(Debug, Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HelpCorpusDocument {
    pub id: String,
    pub path: String,
    pub markdown: String,
}

/// The corpus allowlist: (stable id, path relative to EVERY language
/// tree — the trees are isomorphic). Order matches the frontend
/// manifest; ids never repeat.
const HELP_DOCUMENTS: &[(&str, &str)] = &[
    ("app-tutorial", "app-tutorial.md"),
    ("template-guide", "template-guide.md"),
    ("modules-readme", "modules/README.md"),
    ("modules-qr", "modules/qr.md"),
    ("modules-players", "modules/players.md"),
    ("modules-theme-follow", "modules/theme-follow.md"),
    ("modules-locale-follow", "modules/locale-follow.md"),
    ("modules-audio", "modules/audio.md"),
    ("reference-readme", "reference/README.md"),
    ("reference-digital-score", "reference/digital-score.md"),
    ("reference-network", "reference/network.md"),
    ("reference-audio-modes", "reference/audio-modes.md"),
    (
        "reference-runtime-contract",
        "reference/runtime-contract.md",
    ),
    ("reference-structure", "reference/structure.md"),
    ("reference-manifest", "reference/manifest.md"),
    ("reference-pnds-bundle", "reference/pnds-bundle.md"),
    ("reference-supercollider", "reference/supercollider.md"),
    ("reference-osc", "reference/osc.md"),
    ("reference-p5js", "reference/p5js.md"),
];

/// Where a document may live, most specific first: the app bundle's
/// resources (release, `help/<tree>/…`), then — debug builds only —
/// the repository's language tree (the single source of truth, live
/// during development).
fn document_candidates(app: &AppHandle, tree: &str, docs_relative: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("help").join(tree).join(docs_relative));
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(DOCS_ROOT)
            .join(tree)
            .join(docs_relative),
    );
    candidates
}

/// Reads one document from its first readable candidate. An unreadable
/// document is a broken app bundle or a renamed doc file — loud beats a
/// help center that silently hides pages.
fn read_document(id: &str, candidates: &[PathBuf]) -> Result<String, String> {
    for path in candidates {
        if let Ok(markdown) = std::fs::read_to_string(path) {
            return Ok(markdown);
        }
    }
    let looked = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "help document \"{id}\" is unreadable (looked in {looked})"
    ))
}

/// The language tree a locale asks for. An unknown locale is an
/// explicit error naming the registered trees — never a silent stand-in
/// (`en` must not quietly serve zh-CN's corpus, and vice versa).
fn corpus_tree(locale: &str) -> Result<&'static str, String> {
    HELP_TREES
        .iter()
        .copied()
        .find(|tree| *tree == locale)
        .ok_or_else(|| {
            format!("unknown help locale \"{locale}\" — the corpus ships in {HELP_TREES:?}")
        })
}

/// Reads every registered document from one language tree through the
/// given candidate resolver — the testable core `help_corpus` delegates
/// to (the command adds only the AppHandle-based resolver). The first
/// unreadable document fails the whole call, naming the document and
/// the paths it looked in.
fn read_corpus(
    candidates: impl Fn(&str) -> Vec<PathBuf>,
) -> Result<Vec<HelpCorpusDocument>, String> {
    HELP_DOCUMENTS
        .iter()
        .map(|(id, docs_relative)| {
            read_document(id, &candidates(docs_relative)).map(|markdown| HelpCorpusDocument {
                id: (*id).to_string(),
                path: (*docs_relative).to_string(),
                markdown,
            })
        })
        .collect()
}

/// v1.3.0 (issue #53): the help center's corpus — every shipped document
/// as raw markdown, in manifest order, from the locale's language tree
/// (#68; the frontend passes the resolved UI locale). Reads the files
/// on every call so dev edits show up without a restart; at the
/// corpus's scale this is a few milliseconds.
#[tauri::command]
#[specta::specta]
pub async fn help_corpus(
    app: AppHandle,
    locale: String,
) -> Result<Vec<HelpCorpusDocument>, String> {
    let tree = corpus_tree(&locale)?;
    read_corpus(|docs_relative| document_candidates(&app, tree, docs_relative))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::Path;

    /// Every markdown file under one language tree, as `/`-separated
    /// paths relative to the tree root (subdirectories included).
    fn tree_markdown_files(tree: &str) -> Vec<String> {
        fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
            let entries =
                fs::read_dir(dir).unwrap_or_else(|err| panic!("read {}: {err}", dir.display()));
            for entry in entries {
                let entry = entry.expect("directory entry readable");
                let name = entry.file_name().to_string_lossy().into_owned();
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if entry.file_type().expect("file type readable").is_dir() {
                    walk(&entry.path(), &relative, out);
                } else if name.ends_with(".md") {
                    out.push(relative);
                }
            }
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(DOCS_ROOT)
            .join(tree);
        let mut files = Vec::new();
        walk(&root, "", &mut files);
        files.sort();
        files
    }

    /// Every shipped document exists at its listed path in EVERY
    /// language tree — a rename in one tree breaks the bundle
    /// contract, so it must break the build, not the help center at
    /// runtime.
    #[test]
    fn every_shipped_document_exists_in_every_language_tree() {
        for tree in HELP_TREES {
            for (id, docs_relative) in HELP_DOCUMENTS {
                let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join(DOCS_ROOT)
                    .join(tree)
                    .join(docs_relative);
                assert!(
                    path.is_file(),
                    "help document {id}: {docs_relative} missing in the {tree} tree at {}",
                    path.display()
                );
            }
        }
    }

    /// ADR-0001: the language trees are mirror trees. Their markdown
    /// file sets must be equal — and equal to the registered document
    /// list, so a page missing its translation on either side, or an
    /// unregistered page sneaking into a tree, fails here instead of
    /// shipping an incomplete or half-hidden corpus.
    #[test]
    fn language_trees_carry_identical_file_sets() {
        let registered: BTreeSet<String> = HELP_DOCUMENTS
            .iter()
            .map(|(_, path)| (*path).to_string())
            .collect();
        for tree in HELP_TREES {
            let files: BTreeSet<String> = tree_markdown_files(tree).into_iter().collect();
            assert!(
                !files.is_empty(),
                "the {tree} tree carries no markdown files at all"
            );
            for unregistered in files.difference(&registered) {
                panic!("{tree} tree carries an unregistered document: {unregistered}");
            }
            for missing in registered.difference(&files) {
                panic!("{tree} tree is missing a registered document: {missing}");
            }
        }
    }

    /// The release bundle carries every tree: tauri.conf.json maps each
    /// repository file `../docs/<tree>/<path>` into `help/<tree>/<path>`.
    /// A missing line ships a bundle without that page in that language.
    #[test]
    fn bundle_resources_cover_every_language_tree() {
        let conf = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
            .expect("tauri.conf.json is readable");
        let conf: serde_json::Value = serde_json::from_str(&conf).expect("tauri.conf.json parses");
        let resources = conf
            .get("bundle")
            .and_then(|bundle| bundle.get("resources"))
            .and_then(|resources| resources.as_object())
            .expect("bundle.resources is an object");

        for tree in HELP_TREES {
            for (_, docs_relative) in HELP_DOCUMENTS {
                let source = format!("../docs/{tree}/{docs_relative}");
                let destination = format!("help/{tree}/{docs_relative}");
                assert_eq!(
                    resources.get(&source).and_then(|value| value.as_str()),
                    Some(destination.as_str()),
                    "bundle.resources must map {source} to {destination}"
                );
            }
        }

        // No stale help/ mappings left behind by a tree move.
        for (source, destination) in resources {
            if destination
                .as_str()
                .is_some_and(|destination| destination.starts_with("help/"))
            {
                let from_a_registered_tree = HELP_TREES
                    .iter()
                    .any(|tree| source.starts_with(&format!("../docs/{tree}/")));
                assert!(
                    from_a_registered_tree,
                    "bundle.resources carries a stale help mapping: {source}"
                );
            }
        }
    }

    /// The frontend manifest must know every id this list ships (the
    /// string check is deliberately blunt: buildHelpCorpus throws at
    /// runtime on drift, this fails the test run instead).
    #[test]
    fn frontend_manifest_knows_every_shipped_id() {
        let manifest = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/lib/help-corpus.ts"
        ))
        .expect("src/lib/help-corpus.ts is readable");
        for (id, _) in HELP_DOCUMENTS {
            assert!(
                manifest.contains(&format!("'{id}'")),
                "frontend manifest (help-corpus.ts) does not list id \"{id}\""
            );
        }
    }

    /// A locale outside the registered trees is an explicit error
    /// naming the trees — never a quiet stand-in for another language.
    #[test]
    fn rejects_an_unknown_locale_naming_the_registered_trees() {
        assert_eq!(corpus_tree("zh-CN").unwrap(), "zh-CN");
        assert_eq!(corpus_tree("en").unwrap(), "en");
        let error = corpus_tree("fr").unwrap_err();
        assert!(error.contains("\"fr\""), "names the locale: {error}");
        assert!(error.contains("zh-CN"), "names the trees: {error}");
        assert!(error.contains("en"), "names the trees: {error}");
    }

    /// Simulated missing file at the command layer (#68): the tree that
    /// lost a document fails the whole call, naming the document and
    /// the path it looked in — the other language's corpus is never
    /// served in its place.
    #[test]
    fn read_corpus_fails_loudly_when_a_tree_is_missing_a_document() {
        let tree = tempfile::tempdir().unwrap();
        for (id, docs_relative) in HELP_DOCUMENTS {
            if *id == "reference-osc" {
                continue; // this document went missing from the tree
            }
            let path = tree.path().join(docs_relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, format!("# {id}\n")).unwrap();
        }
        let error = read_corpus(|docs_relative| vec![tree.path().join(docs_relative)]).unwrap_err();
        assert!(
            error.contains("\"reference-osc\""),
            "names the document: {error}"
        );
        assert!(error.contains("osc.md"), "names the path: {error}");
    }

    #[test]
    fn reads_the_first_readable_candidate_and_names_missing_documents() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        fs::write(second.path().join("doc.md"), "# 后备路径").unwrap();

        assert_eq!(
            read_document(
                "doc",
                &[first.path().join("doc.md"), second.path().join("doc.md")]
            )
            .unwrap(),
            "# 后备路径"
        );

        let error = read_document("doc", &[first.path().join("doc.md")]).unwrap_err();
        assert!(
            error.contains("\"doc\""),
            "error names the document: {error}"
        );
        assert!(error.contains("doc.md"), "error names the paths: {error}");
    }
}
