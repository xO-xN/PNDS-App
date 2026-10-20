import type { GitComparisonLine } from './tauri-bindings'

export interface GitSplitRow {
  before: GitComparisonLine | null
  after: GitComparisonLine | null
}

/** Pair each contiguous replacement block; never pair across unchanged context. */
export function splitGitLines(lines: GitComparisonLine[]): GitSplitRow[] {
  const rows: GitSplitRow[] = []
  let deleted: GitComparisonLine[] = []
  let added: GitComparisonLine[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index++)
      rows.push({ before: deleted[index] ?? null, after: added[index] ?? null })
    deleted = []
    added = []
  }
  for (const line of lines) {
    if (line.kind === 'context') {
      flush()
      rows.push({ before: line, after: line })
    } else if (line.kind === 'deletion') deleted.push(line)
    else added.push(line)
  }
  flush()
  return rows
}
