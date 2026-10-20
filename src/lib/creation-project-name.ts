/** Keep the directory suggestion independent after its first manual edit. */
export function creationProjectFolderName(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return `${[...(stem || 'untitled')].slice(0, 59).join('').replace(/-+$/, '')}-pnds`
}
