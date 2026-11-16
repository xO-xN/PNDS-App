import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Deliberately local, reviewable compatibility patch to the exact npm release.
// Reject another release rather than silently applying minified-source edits.
const root = new URL('../node_modules/ghostty-web/', import.meta.url)
const js = new URL('dist/ghostty-web.js', root)
let source = await readFile(js, 'utf8')
const marker = '// PNDS ghostty-web 0.4.0 local compatibility patch v1'
if (!source.startsWith(marker)) {
  const digest = createHash('sha256').update(source).digest('hex')
  if (
    digest !==
    '078b3fe37e4ef469d3f3d7772ee263070f8613e5a6f5ff305c85778907f45e72'
  )
    throw new Error(`Unexpected Ghostty release bytes: ${digest}`)
  const replace = (before, after) => {
    if (!source.includes(before))
      throw new Error(`Missing Ghostty patch anchor: ${before.slice(0, 80)}`)
    source = source.replace(before, after)
  }
  // The uint32 ABI masks RGB bytes. Bit 24 distinguishes explicit pure black
  // from the upstream zero = unspecified sentinel, without changing RGB.
  replace(
    'return Number.isNaN(E) ? 0 : E;',
    'return Number.isNaN(E) ? 0 : E === 0 ? 0x1000000 : E;'
  )
  replace(
    'return g << 16 | E << 8 | C;',
    'return (g << 16 | E << 8 | C) || 0x1000000;'
  )
  replace(
    '  startRenderLoop() {',
    `  setVisible(A) {
    if (this.renderVisible === A) return;
    this.renderVisible = A;
    if (this.animationFrameId !== undefined) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = undefined;
    if (A && this.isOpen && !this.isDisposed) {
      this.renderer.render(this.wasmTerm, true, this.viewportY, this, this.scrollbarOpacity);
      this.startRenderLoop();
    }
  }
  startRenderLoop() {`
  )
  replace(
    'if (!this.isDisposed && this.isOpen) {',
    'if (!this.isDisposed && this.isOpen && this.renderVisible !== false) {'
  )
  replace(
    'else\n          k += " ";',
    'else if (!a || a.width !== 0)\n          k += " ";'
  )
  // A local WASM URL is mandatory; the default inline data URI defeats CSP and
  // duplicates the binary in the JS chunk. This app never calls upstream init().
  const begin = source.indexOf('  static async load(A) {')
  const end = source.indexOf('  static async loadFromPath(A) {', begin)
  if (begin < 0 || end < 0)
    throw new Error('Missing Ghostty local-loader anchors')
  source =
    source.slice(0, begin) +
    `  static async load(A) {
    if (!A) throw new Error("PNDS requires a local Ghostty WASM URL");
    return q.loadFromPath(A);
  }
` +
    source.slice(end)
  await writeFile(js, `${marker}\n${source}`)
}
const types = new URL('dist/index.d.ts', root)
let declarations = await readFile(types, 'utf8')
if (!declarations.includes('setVisible(visible: boolean): void;')) {
  const anchor = 'export declare class Terminal implements ITerminalCore {'
  if (!declarations.includes(anchor))
    throw new Error('Missing Ghostty Terminal declaration')
  declarations = declarations.replace(
    anchor,
    `${anchor}\n    /** PNDS: pause painting while preserving VT state and input/output. */\n    setVisible(visible: boolean): void;`
  )
  await writeFile(types, declarations)
}
console.log(`Patched local Ghostty surface: ${fileURLToPath(js)}`)
