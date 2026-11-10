import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const directories = []
afterEach(() =>
  directories
    .splice(0)
    .forEach(path => rmSync(path, { recursive: true, force: true }))
)

function run(report) {
  const directory = mkdtempSync(join(tmpdir(), 'pnds-native-verifier-'))
  directories.push(directory)
  if (report)
    writeFileSync(join(directory, 'result.json'), JSON.stringify(report))
  const cargo = join(directory, 'cargo')
  writeFileSync(
    cargo,
    `#!/usr/bin/env node\nconsole.error('Native entry evidence directory: '+${JSON.stringify(directory)});\n`
  )
  chmodSync(cargo, 0o700)
  return spawnSync(
    process.execPath,
    [resolve('scripts/verify-native-project-media.mjs')],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    }
  )
}

it('accepts a native run only after its actual report says passed', () => {
  expect(run({ result: 'passed' }).status).toBe(0)
})

it.each([null, { result: 'failed' }])(
  'rejects a false-success runner exit with report %j',
  report => {
    const result = run(report)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Native media verification failed:')
  }
)
