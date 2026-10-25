#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The release formats supported by PNDS's preparation and CI commands. */
export function parseReleaseVersion(input) {
  const match =
    /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(beta|rc)\.[1-9]\d*)?)$/.exec(
      input ?? ''
    )
  if (!match || match[0] !== input) {
    throw new Error(
      'Expected X.Y.Z, X.Y.Z-beta.N or X.Y.Z-rc.N (N >= 1), optionally prefixed with v'
    )
  }
  const version = match[1]
  const tag = `v${version}`
  return {
    tag,
    version,
    prerelease: Boolean(match[2]),
    notesPath: `docs/releases/${tag}.md`,
  }
}

function cargoVersion(source, lockfile) {
  const sections = lockfile
    ? source.split(/^\[\[package\]\]\s*$/m).slice(1)
    : source
        .split(/^\[package\]\s*$/m)
        .slice(1)
        .map(section => section.split(/^\[/m)[0])
  const app = sections.filter(section =>
    /^name\s*=\s*"pnds-app"\s*$/m.test(section)
  )
  if (app.length !== 1) throw new Error('Expected exactly one pnds-app package')
  return /^version\s*=\s*"([^"]+)"\s*$/m.exec(app[0])?.[1]
}

/** Validate the immutable release inputs before any build or GitHub write. */
export function readReleaseMetadata(tag, root = process.cwd()) {
  const metadata = parseReleaseVersion(tag)
  if (tag !== metadata.tag)
    throw new Error(`Release tag must be ${metadata.tag}`)
  const read = file => readFileSync(path.join(root, file), 'utf8')
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
  const versions = [
    ['package.json', pkg.version],
    ['package-lock.json', lock.version],
    ['package-lock.json packages[""]', lock.packages?.['']?.version],
    ['src-tauri/Cargo.toml', cargoVersion(read('src-tauri/Cargo.toml'), false)],
    ['src-tauri/Cargo.lock', cargoVersion(read('src-tauri/Cargo.lock'), true)],
    ['src-tauri/tauri.conf.json', tauri.version],
  ]
  for (const [file, version] of versions) {
    if (version !== metadata.version) {
      throw new Error(
        `${file}: expected ${metadata.version}, found ${version ?? 'no version'}`
      )
    }
  }
  if (!read(metadata.notesPath).trim()) {
    throw new Error(`Release notes are empty: ${metadata.notesPath}`)
  }
  return metadata
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        'Usage: node scripts/release-metadata.mjs <vX.Y.Z[-beta.N|-rc.N]>'
      )
    const metadata = readReleaseMetadata(process.argv[2])
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `tag=${metadata.tag}\nversion=${metadata.version}\nprerelease=${metadata.prerelease}\nnotes_path=${metadata.notesPath}\n`
      )
    }
    console.log(JSON.stringify(metadata))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
