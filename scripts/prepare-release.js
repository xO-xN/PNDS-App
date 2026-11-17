#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  parseReleaseVersion,
  readReleaseMetadata,
} from './release-metadata.mjs'

const JSON_FILES = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
]
const VERSION_FILES = [
  ...JSON_FILES,
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
]
const USAGE =
  'Usage: npm run release:prepare -- v1.7.0-beta.1 (or v1.7.0-rc.1 / v1.7.0)'

function updateCargoVersion(source, header, version, file) {
  const sections = source.split(/(?=^\[)/m)
  const matches = sections.flatMap((section, index) =>
    section.split(/\r?\n/, 1)[0].trim() === header &&
    /^name\s*=\s*"pnds-app"\s*$/m.test(section)
      ? [index]
      : []
  )
  if (matches.length !== 1) {
    throw new Error(`${file}: expected one pnds-app package`)
  }
  const index = matches[0]
  if (!/^version\s*=\s*"[^"\r\n]+"/m.test(sections[index])) {
    throw new Error(`${file}: missing pnds-app package version`)
  }
  sections[index] = sections[index].replace(
    /^(version\s*=\s*")[^"\r\n]+(")/m,
    (_line, before, after) => `${before}${version}${after}`
  )
  return sections.join('')
}

export function prepareReleaseFiles(input, root = process.cwd()) {
  const metadata = parseReleaseVersion(input)
  if (!fs.readFileSync(path.join(root, metadata.notesPath), 'utf8').trim()) {
    throw new Error(`Release notes are empty: ${metadata.notesPath}`)
  }
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  if (status.trim()) {
    throw new Error(
      'Working directory is not clean. Review and commit or stash changes first.'
    )
  }

  // Prepare every edit before writing so malformed metadata cannot leave a partial bump.
  const updates = new Map()
  for (const file of JSON_FILES) {
    const content = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
    if (typeof content.version !== 'string') {
      throw new Error(`${file}: missing version`)
    }
    content.version = metadata.version
    if (file === 'package-lock.json') {
      if (typeof content.packages?.['']?.version !== 'string') {
        throw new Error(`${file}: missing root package version`)
      }
      content.packages[''].version = metadata.version
    }
    updates.set(file, JSON.stringify(content, null, 2) + '\n')
  }
  for (const [file, header] of [
    ['src-tauri/Cargo.toml', '[package]'],
    ['src-tauri/Cargo.lock', '[[package]]'],
  ]) {
    updates.set(
      file,
      updateCargoVersion(
        fs.readFileSync(path.join(root, file), 'utf8'),
        header,
        metadata.version,
        file
      )
    )
  }
  for (const [file, content] of updates) {
    fs.writeFileSync(path.join(root, file), content)
  }
  return metadata
}

export function prepareRelease(input, root = process.cwd()) {
  const metadata = prepareReleaseFiles(input, root)
  execFileSync(
    'npm',
    ['exec', '--no', '--', 'prettier', '--write', ...JSON_FILES],
    {
      cwd: root,
      stdio: 'inherit',
    }
  )
  readReleaseMetadata(metadata.tag, root)
  console.log(`Checking the prepared ${metadata.tag} source...`)
  execFileSync('npm', ['run', 'check:all'], { cwd: root, stdio: 'inherit' })
  readReleaseMetadata(metadata.tag, root)

  console.log(
    `Prepared ${metadata.tag}; all checks passed. Nothing has been committed or published.`
  )
  console.log('Review the version changes, then run these commands when ready:')
  console.log(`  git diff -- ${VERSION_FILES.join(' ')}`)
  console.log(`  git add -- ${VERSION_FILES.join(' ')}`)
  console.log(`  git commit -m "chore: prepare ${metadata.tag}"`)
  console.log(`  git tag ${metadata.tag}`)
  console.log(`  git push origin refs/tags/${metadata.tag}`)
  console.log(
    'The tag starts a draft release build; inspect its assets before publishing.'
  )
  if (metadata.prerelease) {
    console.log(
      'Publish as a prerelease, never Latest. Beta testers install updates manually.'
    )
  }
  return metadata
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(USAGE)
  } else {
    try {
      if (args.length !== 1) throw new Error(USAGE)
      prepareRelease(args[0])
    } catch (error) {
      console.error('Release preparation failed:', error.message)
      process.exitCode = 1
    }
  }
}
