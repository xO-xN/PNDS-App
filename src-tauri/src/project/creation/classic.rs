//! Fixed, verified Classic source; no runtime source checkout or network access.
use super::*;
use crate::project::handoff::AGENT_ENTRY;
use serde_json::Value;

mod frozen {
    include!("../../../resources/classic-project/assets.rs");
}
const PROVENANCE: &str = include_str!("../../../resources/classic-project/provenance.json");

impl CreationAccess {
    pub fn create_classic(
        &mut self,
        options: &NewProjectOptions,
        resources: &Path,
        protection: &Protection,
    ) -> Result<CreationWorkspace, CreationError> {
        self.create_generated(options, protection, Some(resources), write_classic)
    }
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("verified Classic JSON")
}
fn json_bytes(value: &Value) -> Vec<u8> {
    format!(
        "{}\n",
        serde_json::to_string_pretty(value).expect("JSON metadata")
    )
    .into_bytes()
}
fn text(bytes: &[u8]) -> &str {
    std::str::from_utf8(bytes).expect("verified Classic text")
}
fn metadata(value: &mut Value, options: &NewProjectOptions, id: &str) {
    value["name"] = options.name.trim().into();
    value["version"] = "0.1.0".into();
    value["description"] = options.description.trim().into();
    if value.get("schemaVersion").is_some() {
        value["id"] = id.into();
    } else {
        value["name"] = id.into();
        value["author"] = options.author.trim().into();
    }
}

fn write_classic(root: &File, options: &NewProjectOptions) -> Result<(), CreationError> {
    let id = blank::project_id(&options.folder_name)?;
    let name = options.name.trim();
    let initialized = format!("Created by PNDS App from PNDS Classic (PNDS Template 0.7.0). This project is already initialized: id `{id}`, version `0.1.0`. Keep its identity, client token key, history and current specification when continuing creation. Do not rerun template initialization or install dependencies for App playback.\n\n本工程由 PNDS App 从 PNDS Classic（PNDS Template 0.7.0）创建，身份与版本已初始化。接续创作时保留工程 ID、客户端 token key、历史和当前规格；不要重新初始化。App 内运行使用确切共享包，无需 npm 安装。\n");
    for (path, bytes) in frozen::ASSETS {
        let output = match *path {
            // The reference image is not the creator's cover. All runtime state
            // and Git history are absent from the frozen inclusion set.
            "cover.png" => continue,
            "manifest.json" | "package.json" => {
                let mut value = json(bytes);
                metadata(&mut value, options, &id);
                json_bytes(&value)
            }
            "package-lock.json" => {
                let mut value = json(bytes);
                value["name"] = id.clone().into();
                value["version"] = "0.1.0".into();
                value["packages"][""]["name"] = id.clone().into();
                value["packages"][""]["version"] = "0.1.0".into();
                json_bytes(&value)
            }
            "public/shared.js" => text(bytes).replace("\"pnds-template-token\"", &format!("\"{id}-token\"")).into_bytes(),
            "public/index.html" => text(bytes).replace("<title>PNDS Template</title>", &format!("<title>{}</title>", blank::html(name))).into_bytes(),
            "README.md" | "README.zh-CN.md" => readme(text(bytes), options, *path == "README.zh-CN.md", &initialized).into_bytes(),
            "AGENTS.md" => {
                let source = text(bytes)
                    .replacen("PNDS Template：", &format!("{name}："), 1)
                    .replace(
                        "- 发布包由 `.github/workflows/package.yml` 按 ALLOWLIST 组装（docs / test / 源码不进演出包，`node_modules` 预装）。",
                        "- 发布打包：按指针表读取 `reference/pnds-bundle.md`，按 `docs/implementation.md` 的「发布」节在 PNDS App 生成 `.pnds`；本工程的 `sharedLibraries` 引用要求接收方 App 提供声明的确切共享版本。",
                    );
                format!("# Initialized project / 已初始化工程\n\n{initialized}\n{AGENT_ENTRY}\n\n{source}").into_bytes()
            }
            "docs/start.md" => format!("# Continuing creation / 接续创作\n\n{initialized}\nRead AGENTS.md and docs/creator-handoff.md, then update docs/implementation.md with the creator's intentions.\n先读 AGENTS.md 与 docs/creator-handoff.md，再按创作者意图更新 docs/implementation.md。\n").into_bytes(),
            "docs/implementation.md" => {
                let source = text(bytes)
                    .replacen("# PNDS Template —", &format!("# {name} —"), 1)
                    .replace(
                        "带生产依赖的发布包由 `.github/workflows/package.yml` 构建（ALLOWLIST 裁剪，`node_modules` 预装，docs / test / 源码不进演出包）。完整的发布流程与发布前检查清单见 PNDS App 的[创作指南第 4 节](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/template-guide.md)。",
                        "在 PNDS App 创作模式保存并手动测试本工程，再从工作台顶栏选择「生成 .pnds」。工程的 `sharedLibraries` 引用随包分发，共享库仍由接收方 App 提供，必须具备 manifest 声明的确切版本；只打包磁盘保存版，未保存草稿不入包。打包与安装规则按 AGENTS.md 指针表读取 `reference/pnds-bundle.md`，创作发布工作流读取 `template-guide.md`。",
                    );
                format!("# Creation source / 创建来源\n\n{initialized}\nThe inherited reference behavior below is the initial implementation, not a constraint on the new project. Source provenance is in template-source.json.\n继承的参考行为是初始实现，不约束新工程的创作方向。来源记录见 template-source.json。\n\n{source}").into_bytes()
            }
            _ => bytes.to_vec(),
        };
        blank::write(root, path, &output)?;
    }
    blank::write(root, "docs/template-source.json", PROVENANCE.as_bytes())
}

fn readme(source: &str, options: &NewProjectOptions, chinese: bool, initialized: &str) -> String {
    let name = options.name.trim();
    let author = options.author.trim();
    let heading = if chinese {
        "### 功能"
    } else {
        "### Features"
    };
    let end = if chinese {
        "### 开始"
    } else {
        "### Getting Started"
    };
    let features = source
        .split_once(heading)
        .expect("verified README features")
        .1
        .split_once(end)
        .expect("verified README start")
        .0;
    let structure = if chinese {
        "### 结构"
    } else {
        "### Structure"
    };
    let tail = source
        .split_once(structure)
        .expect("verified README structure")
        .1;
    let description = if options.description.trim().is_empty() {
        if chinese {
            "从完整双推子参考示例开始创作，保留网络、座位与每位客户端的正弦声音。"
        } else {
            "Start from the complete two-fader reference, with networking, client seats and a sine voice per client."
        }
    } else {
        options.description.trim()
    };
    format!("# {name}\n\n[中文](README.zh-CN.md) | [English](README.md)\n\ntitle: {name}\ncomposer: {author}\n\n## Description / 简介\n\n{description}\n\n## Continuing creation / 接续创作\n\n{initialized}\nRead [AGENTS.md](AGENTS.md), [docs/creator-handoff.md](docs/creator-handoff.md) and [docs/implementation.md](docs/implementation.md). Start this project manually in PNDS App. Standalone development can install the exact package.json dependencies separately.\n\n{heading}{features}{structure}{tail}")
}
