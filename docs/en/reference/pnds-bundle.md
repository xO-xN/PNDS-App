# The .pnds Bundle

## What it is

A `.pnds` file is a **transport container**: one self-contained score Project plus a piece of bundle metadata, compressed into a single file for easy copying and distribution.

- the Project directory inside the bundle is an ordinary directory Project that complies with the project-structure spec in [structure.md](./structure.md);
- the App never runs a Project from inside the archive — installation unpacks it once, and it then runs exactly like a directory Project;
- the compression format affects no runtime behaviour (processes, health, audio, shutdown protocol).

## File format

`.pnds` = a ZIP archive (deflate) with a fixed top-level layout:

```text
<root>/                     # exactly one root directory holding the runnable Project
├── manifest.json
├── server.js
├── node_modules/…          # only when the Project declares production dependencies
└── …                       # the Project's remaining files (original relative structure and permissions)
pnds-bundle.json            # bundle metadata (at the archive top level, outside the Project directory)
```

Rules:

- the top level must carry **exactly one directory entry**; the only other top-level entry allowed is `pnds-bundle.json`;
- the layout, validation and containment rules inside the Project root are defined entirely by the project-structure spec — this spec neither repeats nor relaxes them;
- the root directory name SHOULD be the Project's display name (sanitised at packing per the Packing section); the opening side MUST NOT rely on this name to locate the Project (the single root directory + `manifest.json` is authoritative);
- file entries should keep their unix permission bits (executables inside node_modules depend on them);
- entries inside the archive always use relative paths with forward slashes; absolute paths, `..` escapes and symlink entries are all illegal (the opening side must reject them).

## Packing

Entry point: **Settings (⌘,) → Developer Tools → 「打包工程」 (Bundle Project)**. It packs the selected Project by default; **「浏览…」 (Browse…)** picks any other folder.

Pre-pack validation (any failure refuses packing with a readable error):

1. `manifest.json` passes the App's full load validation (including every synthdef artifact the manifest references being present);
2. dependency check: when `package.json` declares non-empty production dependencies (`dependencies` / `optionalDependencies`), the Project must already carry `node_modules/`;
3. packing itself **runs no npm commands**, touches no network, and modifies nothing in the source Project directory.

Staging and the exclusion list:

- copying happens in a staging area in the system temp directory; the source Project directory is left untouched;
- excluded (never enters the bundle): `.DS_Store` and `.git*` files/directories at any depth; the `docs/`, `test/` and `tests/` directories directly under the Project root only (authoring material, not runtime assets);
- symlinks in the source Project: targets inside the Project directory are materialised as ordinary file copies; targets outside are skipped;
- every other file is copied verbatim (including `node_modules/`, `.scd` sources, audio/, public/, … — exclusion only subtracts; nothing is ever reordered or rewritten);
- devDependencies don't affect the validation but do ride along inside `node_modules` — running `npm prune --omit=dev` before release meaningfully shrinks the `.pnds`.

Artifacts:

- output path: `<name>-<version>.pnds` beside the Project directory, where `name` is the sanitised manifest `name` (replacing `/\:*?"<>|` with `-`) and `version` is the manifest `version`;
- when a file of that name already exists, the UI layer confirms before overwriting (overwrite = full rewrite);
- writing uses a temp file in the same directory plus an atomic rename;
- on success the App shows the creator the artifact path and the file's sha256 (hexadecimal) for manual verification after distribution. The v1 opening side does **not** enforce sha256.

`pnds-bundle.json`:

```json
{
  "formatVersion": 1,
  "packedWith": "1.2.0",
  "packedAt": "2026-08-17T12:00:00Z",
  "sourcePlatform": "macos-arm64"
}
```

| Field            | Type             | Meaning                                                                                              |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `formatVersion`  | positive integer | the spec version, currently `1`; the opening side supports only versions it knows                    |
| `packedWith`     | string           | the packing App's version (record only)                                                              |
| `packedAt`       | string           | packing time, RFC 3339 UTC (record only)                                                             |
| `sourcePlatform` | string           | the packing machine's platform tag (record only; v1 opens without enforcing a target-platform check) |

## Installation

Double-click a `.pnds` (the App declares the file association) or pick it in the ⌘O dialog — dragging the file onto the App window or Dock icon is the same as double-clicking. The App:

1. validates `pnds-bundle.json` (present, parseable, `formatVersion` supported);
2. validates the structure (single root directory, `manifest.json` inside it);
3. synchronously unpacks once into the App data directory `bundles/<id>-<version>/` (`id` and `version` taken from the manifest inside the bundle);
4. runs the full manifest validation against the installed directory;
5. then flows through exactly the same openProject → preflight → session pipeline as a directory Project.

The Project list (sidebar and Settings → Projects) shows the manifest's `name` (the App learns and persists it after every successful preflight), not the install directory name `<id>-<version>`; a manual rename (⌘R) still takes precedence.

Overwriting reinstall:

- the install directory name follows `<id>-<version>`; opening the same `id`+`version` again **always reinstalls over it** (old directory deleted, then unpacked);
- `id` and `version` must each be a single path segment (values containing `/`, `\` or `..` are rejected).

Security:

- every entry is validated before unpacking: absolute paths, `..` escapes and symlink entries are rejected (zip-slip protection);
- a bundle is a creator's deliverable, but the App grants it no extra powers: an installed Project runs under the same boundaries as any ordinary directory Project.

Directory reclamation:

- `bundles/` is App-managed territory: removing a Project from the project history whose install directory sits directly under `bundles/` also deletes that unpacked directory;
- ordinary Projects on the user's disk are untouched (nothing outside `bundles/` is ever deleted).

## Version semantics: any content change must bump the version

The recipient's install slot is decided by **`<id>-<version>`**, and re-opening the same `id`+`version` **always reinstalls over it** (delete old directory, unpack; the file opened last wins).

So **any content change must increment the manifest's `version`**. What happens without the bump:

- both builds share one file name `<name>-<version>.pnds` and one install slot, and the recipient's App **cannot tell** new content from old;
- the moment the recipient re-opens an old `.pnds` copy they still have around (download folder, email attachment — common), the overwrite writes back the **old** content — you think you shipped a fix, they still perform the old version;
- the two builds' sha256 differ, but the App doesn't check it — nothing saves you.

With the bump it's a clean new slot and a new file name; old and new coexist. Two notes:

- after a new version is installed, the old version's entry in the recipient's list doesn't vanish on its own — remove it manually (removal also reclaims its unpacked directory);
- `id` and `version` must each be a single path segment (no `/`, `\`, `..`); a lowercase-hyphenated `id` and a semver-style `version` like `0.1.2` are recommended: fixes bump the patch, new capabilities the minor, breaking changes the major.

## Distribution

Send the `.pnds` file to the recipient (cloud drive, AirDrop, USB stick, email all work) **together with its sha256**. The recipient needs PNDS App installed — but not Node.js, not SuperCollider, and no network.

The sha256 confirms that what was sent and what arrived are the same file. The recipient runs in a terminal:

```sh
shasum -a 256 <name>-<version>.pnds
```

A match with the creator's value means the transfer was lossless and it's the intended build.

## Authoring machine vs performance machine

|               | Authoring machine (your Mac)                    | Performance machine (recipient's Mac)                 |
| ------------- | ----------------------------------------------- | ----------------------------------------------------- |
| PNDS App      | required                                        | required                                              |
| Node.js       | required (development and `npm install`)        | not required (the App bundles a fixed Node)           |
| SuperCollider | Internal mode: required (SynthDef compile only) | Internal mode: not required (the App bundles scsynth) |
| npm / network | available during authoring                      | neither needed to run or install a `.pnds`            |

On the performance machine a Project **must not depend on** a host-installed Node.js, SuperCollider, `sclang` or third-party UGens.

## The shape of the built-in tools

The built-in tools (Local Network Diagnostics, Multichannel Signal Generator, Telematic Network Diagnostics) release as `.pnds` like every other Project: each tool repository's CI assembles and publishes per the file-format layout. Shipping inside the App uses the **unpacked folder form**: at App build time they are fetched per the registry (`utilities.json`, committed with the repository) — a failed sha256 check fails the build; after validating the bundle layout (single root directory + top-level `pnds-bundle.json` + manifest id matching the registry), the Project directory is unpacked to the stable path `Contents/Resources/utilities/<id>/` (version-free), and the App runs that directory in place instead of installing into the data directory `bundles/`.

- entry shape: Utilities is a protected folder (pinned to the bottom, cannot be renamed or deleted); the built-in tools list as ordinary Project entries and start through the standard preflight → spawn → health → monitor flow, with no separate launcher UI;
- removing a tool from Utilities doesn't reappear after a restart (the folder is seeded only when missing);
- there is no "copy out as an ordinary Project"; the resources travel with the App bundle — copy manually if you need a duplicate.

## Compliance checklist

A `.pnds` artifact should at minimum:

1. be a zip (deflate) archive whose top level = the single Project root directory + `pnds-bundle.json`;
2. carry a Project that passes the first three items of the project compliance checklist in [structure.md](./structure.md) (manifest validation, path containment, production dependencies packed);
3. have the exclusion list applied (no `.git`, `.DS_Store`, or other non-runtime files);
4. preserve file permission bits;
5. preflight and start directly after installation on another machine.
