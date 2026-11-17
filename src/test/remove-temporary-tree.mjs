import { execFileSync } from 'node:child_process'
import { readdirSync, rmdirSync } from 'node:fs'
import path from 'node:path'

/** Remove fixture files without following symlinks to shared dependencies. */
export function removeTemporaryTree(root) {
  const files = []
  const directories = []
  function collect(directory) {
    directories.push(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(target)
      else files.push(target)
    }
  }
  collect(root)
  if (files.length) execFileSync('rm', ['-f', '--', ...files])
  for (const directory of directories.reverse()) rmdirSync(directory)
}
