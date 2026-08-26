//! Help-center corpus loading (v1.3.0, issue #53; zh-CN tree move, #66).
//!
//! The three Chinese docs (使用教程 / 创作指南 / 参考手册) ship in the app
//! resources as RAW markdown — `docs/zh-CN/*.md` in the repository is
//! the only source, copied verbatim by the bundler (tauri.conf.json maps
//! each file into `help/…`) with no build-time conversion: the help
//! window renders markdown at runtime and builds its search index in
//! memory (#53's decision, superseding the spec's original build-time
//! HTML+index plan). developer/ and agents/ docs are deliberately NOT
//! in this list.
//!
//! Dev builds read the repository's language tree directly (edits are
//! live in `tauri dev`); release builds read the bundled copies. The id
//! list is the stable contract with the frontend manifest
//! (src/lib/help-corpus.ts) — both sides fail loudly on drift.

use std::path::PathBuf;

use specta::Type;
use tauri::{AppHandle, Manager};

/// Where the corpus lives in a repository checkout: the zh-CN language
/// tree (ADR-0001). The `en/` mirror tree (#67) will select this by
/// locale; until then zh-CN is the only tree.
const CORPUS_TREE: &str = "../docs/zh-CN";

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

/// The corpus allowlist: (stable id, path relative to the repository's
/// zh-CN language tree). Order matches the frontend manifest; ids never
/// repeat.
const HELP_DOCUMENTS: &[(&str, &str)] = &[
    ("app-tutorial", "app-tutorial.md"),
    ("template-guide", "template-guide.md"),
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
/// resources (release), then — debug builds only — the repository's
/// zh-CN language tree (the single source of truth, live during
/// development).
fn document_candidates(app: &AppHandle, docs_relative: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("help").join(docs_relative));
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(CORPUS_TREE)
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

/// v1.3.0 (issue #53): the help center's corpus — every shipped document
/// as raw markdown, in manifest order. Reads the files on every call so
/// dev edits show up without a restart; at the corpus's scale this is a
/// few milliseconds.
#[tauri::command]
#[specta::specta]
pub async fn help_corpus(app: AppHandle) -> Result<Vec<HelpCorpusDocument>, String> {
    HELP_DOCUMENTS
        .iter()
        .map(|(id, docs_relative)| {
            read_document(id, &document_candidates(&app, docs_relative)).map(|markdown| {
                HelpCorpusDocument {
                    id: (*id).to_string(),
                    path: (*docs_relative).to_string(),
                    markdown,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// The repository's zh-CN language tree carries every shipped
    /// document at its listed path — a rename here breaks the bundle
    /// contract, so it must break the build, not the help center at
    /// runtime.
    #[test]
    fn every_shipped_document_exists_in_the_language_tree() {
        for (id, docs_relative) in HELP_DOCUMENTS {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(CORPUS_TREE)
                .join(docs_relative);
            assert!(
                path.is_file(),
                "help document {id}: {docs_relative} missing at {}",
                path.display()
            );
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
