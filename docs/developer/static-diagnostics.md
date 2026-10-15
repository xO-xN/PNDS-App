# Static project diagnostics

## Shared report and App Doctor (#203)

The Tauri commands accept the backend-issued workspace identity, capture the
trusted root, release the creation mutex for filesystem I/O and revalidate the
identity before returning. They do not acquire a session lifecycle lock. Opening
the Doctor dialog explicitly starts a check, including during runtime startup or
shutdown. The dialog labels known check, severity and unverified categories in
English and Chinese and retains contract error details and machine codes.

The report schema is version 1. `project` contains saved manifest ID, name and
version when schema parsing succeeds; otherwise it is null. `projectPath` is the
checked root and `checkerVersion` identifies the compiled checker. `inputs` lists
observed project and App resource paths, kinds and opaque version fingerprints.
`inputFingerprint` identifies these observations; it is not a portable project
content hash or proof of runtime behavior. `checks` records each stable category
with `passed`, `failed` or `skipped` and a reason. `issues` records stable codes,
`error` or `warning`, optional field/path locations and reasons. `unverified`
records runtime, ports, health, sound, artistic quality, source wiring and
dependency execution. `staticPassed` requires every selected check to pass.

Manifest schema parsing, contained path resolution, production declaration rules,
exact shared library verification and bundle output-name rules reuse existing
contract services. Path and artifact existence are checked independently; a valid
manifest can still report missing entry, working directory, SynthDefs and local or
shared dependencies together. Invalid prerequisites produce explicit skipped
checks, rather than fabricated failures or a pass. Artifact existence does not
verify SynthDef sound. Local `node_modules` presence satisfies only the existing
directory contract; imports and dependency execution remain unverified.

Reads use a held root and descriptor-relative no-follow opens after containment
resolution. The same held directory descriptors protect the actual shared
catalog parse reads and SHA-256 resource reads, including cache rechecks;
canonical path checks alone never authorize a later ordinary `File::open`.
Each open and final catalog/resolver/report boundary verifies that the selected
root path is still a directory with the held descriptor's device and inode;
renaming/replacing the root or turning it into a symlink invalidates the check.
Opens are nonblocking and the opened descriptor must name a regular file before
text or hash bytes are read, so a FIFO replacement cannot wait for a writer.
Non-regular and unreadable text inputs are explained, and oversized
inputs cannot silently pass. Limits are 1 MiB per manifest/package text, 32 MiB
per shared catalog, 64 MiB per shared resource and 512 MiB per shared report.
Shared resource inventories are deduplicated and verified against the captured
catalog with the existing integrity resolver. Results are deterministic for
unchanged observed inputs and do not execute sources or inspect arbitrary dynamic
resource references.

The App excludes unsaved drafts and shows their count without modifying them.
Saved disk revisions captured before dispatch fence changes during a check; later
disk changes conservatively mark the report stale. Serial background/focus
fingerprint checks also detect changes outside the ordinary project watcher.
Only an explicit new check replaces the report. Late responses are discarded
when the workspace changes or the dialog is closed; error retries remain explicit.

## CLI (#204)

The App and `pnds check` call the same public `diagnose_project` service. The CLI
does not initialize Tauri, load a project, inspect occupied ports, execute author
code, install dependencies, clean up processes or write into the project. It can
read a candidate project while a performance remains active. Reports describe
observed inputs; run the check again after changing a file or shared resource.

The JSON stdout is the complete `DiagnosticReport`, with no logging mixed in.
It includes the report schema, checker version, project identity, observed input
fingerprints, check outcomes and reasons, error/warning issues, skipped checks,
unverified scope and `staticPassed`. Human output shows the same check outcomes,
issues and unverified scope. Success only means the selected static checks passed;
runtime, pages, network, audio devices and sound still require actual acceptance.

| Exit | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | Selected static checks passed (`staticPassed: true`)                |
| 1    | A report was produced but static checks failed or are incomplete    |
| 2    | Invalid command/arguments or an output error; reason goes to stderr |

### 中文使用说明

安装 PNDS App 后直接调用随 App 分发的命令，不需要启动 App：

```bash
"/Applications/PNDS.app/Contents/MacOS/pnds" check "/path/to/project"
"/Applications/PNDS.app/Contents/MacOS/pnds" check "/path/to/project" --json
"/Applications/PNDS.app/Contents/MacOS/pnds" --help
```

共享包固定从此命令旁的 `../Resources/shared-libraries` 读取；移动整个 App 后
仍按新位置读取。不需要全局 Node、开发服务器、网络或隐含依赖安装。文件夹工程没有
共享引用时不要求共享资源。缺资源、损坏或不匹配会报告阻断问题，不回落维护者路径。
命令不读取编辑器里未保存的草稿，不生成 `.pnds`，也不改变正在进行的演出。

若单独复制命令文件，须显式指定同一 App 版本的共享包目录：

```bash
/path/to/pnds check "/path/to/project" --json \
  --resources-root "/path/to/PNDS.app/Contents/Resources/shared-libraries"
```

`--resources-root` 指共享包目录本身（含 `catalog.json`），不是 App 的 Resources
总目录。路径以 `-` 开头时，用 `--` 后接工程路径；选项放在 `--` 前。
退出码 0 只证明所选静态检查通过，不能代替真实页面、设备或声音验收。

### English usage

Invoke the installed command without starting the App:

```bash
"/Applications/PNDS.app/Contents/MacOS/pnds" check "/path/to/project"
"/Applications/PNDS.app/Contents/MacOS/pnds" check "/path/to/project" --json
```

The executable discovers the fixed `../Resources/shared-libraries` directory
beside itself, including after moving the complete App. No global Node, developer
server, network or implicit dependency installation is needed. Projects without
shared references do not need this directory. Missing, damaged or incompatible
resources remain explicit report failures. No maintainer checkout is searched.
The command reads saved files, does not generate a `.pnds` bundle and preserves
the current performance.

When copying the binary separately, pass `--resources-root` pointing to the
matching App version's shared-library directory containing `catalog.json`, as in
the example above. Put options before `--` when checking a leading-dash path.
Exit 0 only confirms static checks; actual pages, devices and sound remain
unverified.

### Build and distribution

`pnds` is an additional Rust binary in the App crate; `default-run = "pnds-app"`
preserves normal Tauri builds. `npm run cli:build` builds and stages the host
architecture; `npm run cli:build:all` stages both `aarch64-apple-darwin` and
`x86_64-apple-darwin`. `PNDS_TARGET` or `--target` selects one supported target;
`--debug` explicitly chooses the debug profile. Both executable slices declare
the App's macOS 13.5 deployment floor. The script copies only the requested
profile's fresh successful build, never a stale alternate profile.

Use the existing [release prerequisites](./releases.md), then run `npm run build`,
`npm run libraries:fetch`, `npm run utilities:fetch` and the CLI build script.
The release workflow does this for both slices before its two Tauri lanes. Local
App builds must stage the matching CLI slice, just as they stage dnsd. The base
macOS file mapping installs the arm64 binary at `Contents/MacOS/pnds`; the Intel
configuration replaces that source with the x86_64 slice. These mappings avoid
making an unbuilt CLI an `externalBin` prerequisite of its own Cargo build.

Public CLI integration tests use the actual binary and temporary projects, a
moved App-like resource layout, deterministic JSON equality against the public
App service, exit status, fixed-resource failures, unchanged project bytes,
occupied ports and an independently running process. They do not claim native
installer, App, physical device or sound acceptance.
