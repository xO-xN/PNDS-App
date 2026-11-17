# The .pnds Bundle

## What it is

A `.pnds` file contains a runnable [project directory](./structure.md) and bundle metadata. The App extracts it before running the project.

## File format

A ZIP (deflate) archive contains one top-level project directory and `pnds-bundle.json`. Use relative paths with forward slashes and retain Unix permissions. Absolute paths, path escapes and archive symlinks are invalid.

| Metadata         | Value                       |
| ---------------- | --------------------------- |
| `formatVersion`  | Integer `1`                 |
| `packedWith`     | Packing App version         |
| `packedAt`       | RFC 3339 UTC time           |
| `sourcePlatform` | Packing platform identifier |

## Packing

Choose **Generate .pnds** in the Creation workspace’s project menu and select the output. Packing reads saved files. The App asks for confirmation when drafts exist or the workspace has no successful test record. Static validation covers the manifest, entry, all declared SynthDefs, production dependencies and exact shared resources.

The bundle retains the README, cover and other project files. It excludes `.DS_Store`, `.git*` and `.pnds-creation` at any depth, and root `docs/`, `test/` and `tests/`. Eligible project symlinks become regular files. Links outside the project or into private data are skipped.

The default file name is a sanitized `<name>-<version>.pnds`. Choose a destination outside the source project and confirm any overwrite. The App shows the path and SHA-256 on success. Packing copies and checks saved files.

## Installation

Open the file by double-clicking, dragging it into the App or using `⌘O`. The App validates the format and project before publishing to `bundles/<id>-<version>/`, then loads it as a project directory. Stop a session that owns the slot before replacing it. A failed installation preserves the installed files. Removing an installed project reclaims its extracted directory.

## Version semantics: any content change must bump the version

Increment the manifest `version` after changing content. The same `id` and `version` share an installation slot, which reinstalling replaces. Each value must be one path segment, excluding slash, backslash and `..`.

## Distribution

Distribute the `.pnds` file and optionally include its SHA-256 for the recipient to check with `shasum -a 256`. The App does not require the digest for installation.

## Distributing shared references

A bundle carries [exact manifest references](./manifest.md#app-shared-package-capability-and-schemaversion-2) to shared packages. The receiving App must supply those versions with all files present. Project models, pages, scores and sound assets travel with the bundle.

## Authoring machine vs performance machine

The performance Mac uses the App’s bundled Node and scsynth. To carry chats, pending documents or recordings, copy the [full source project](./structure.md#private-creation-data), including hidden directories.

## The shape of the built-in tools

The App runs built-in tools from `Contents/Resources/utilities/<id>/`. Open them from the Utilities folder.

## Compliance checklist

Before delivery, verify the archive layout, runtime assets and shared references, then install and start it in the receiving App.
