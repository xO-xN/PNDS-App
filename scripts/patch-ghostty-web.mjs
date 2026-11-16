import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Deliberately local, reviewable compatibility patch to the exact npm release.
// Reject another release rather than silently applying minified-source edits.
const root = new URL('../node_modules/ghostty-web/', import.meta.url)
const js = new URL('dist/ghostty-web.js', root)
const metadata = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8')
)
if (metadata.version !== '0.4.0-next.21.g640db46')
  throw new Error(`Unexpected Ghostty wrapper version: ${metadata.version}`)
const asset = new URL(
  '../src/assets/project-terminal/ghostty-vt.wasm',
  import.meta.url
)
const assetHash = createHash('sha256')
  .update(await readFile(asset))
  .digest('hex')
if (
  assetHash !==
  '9658ac9534e8cf702c72bcbb371de3f36d50f060695216f4fc1f5b4c4823b543'
)
  throw new Error(`Unexpected modified Ghostty WASM: ${assetHash}`)
let source = await readFile(js, 'utf8')
const marker =
  '// PNDS ghostty-web 0.4.0-next.21.g640db46 local compatibility patch v2'
const patchedDigest =
  '2d1b1ce5dba132f485fd62b941c0f0e01ae25ffe16f39a8940acc8657645d99f'
const replace = (before, after) => {
  if (!source.includes(before))
    throw new Error(`Missing Ghostty patch anchor: ${before.slice(0, 80)}`)
  source = source.replace(before, after)
}
const patchInputFocus = () => {
  replace(
    'A.hasAttribute("tabindex") || A.setAttribute("tabindex", "0"), A.setAttribute("contenteditable", "true")',
    'A.setAttribute("tabindex", "-1"), A.setAttribute("contenteditable", "false")'
  )
  replace(
    '    this.isOpen && this.element && (this.element.focus(), setTimeout(() => {\n      var A;\n      (A = this.element) == null || A.focus();\n    }, 0));',
    '    this.isOpen && this.textarea && (this.positionInput(), this.textarea.focus({ preventScroll: true }));'
  )
  replace(
    '    this.isOpen && this.element && this.element.blur();',
    '    this.isOpen && this.textarea && this.textarea.blur();'
  )
  replace(
    'A.parentElement && A.parentElement.focus();',
    'this.terminal.focus();'
  )
  replace(
    'A.parentElement && A.parentElement.focus();',
    'this.terminal.focus();'
  )
  replace(
    '  cleanupCompositionTextNodes() {\n    if (this.container && this.container.childNodes)',
    '  cleanupCompositionTextNodes() {\n    if (this.inputElement && this.inputElement.tagName === "TEXTAREA") this.inputElement.value = "";\n    if (this.container && this.container.childNodes)'
  )
  replace(
    '  focus() {\n    this.isOpen && this.textarea && (this.positionInput(), this.textarea.focus({ preventScroll: true }));',
    `  positionInput() {
    if (!this.textarea || !this.element || !this.renderer || !this.wasmTerm) return;
    if (this.textarea.style.position === "fixed" && this.textarea.style.zIndex === "1000") return;
    const cursor = this.wasmTerm.getCursor();
    const metrics = this.renderer.getMetrics();
    const canvas = this.renderer.getCanvas().getBoundingClientRect();
    const host = this.element.getBoundingClientRect();
    const styles = {
      position: "absolute",
      left: \`\${canvas.left - host.left - this.element.clientLeft + cursor.x * metrics.width}px\`,
      top: \`\${canvas.top - host.top - this.element.clientTop + cursor.y * metrics.height}px\`,
      width: "1px", height: \`\${metrics.height}px\`,
      fontSize: \`\${this.options.fontSize}px\`, fontFamily: this.options.fontFamily,
      lineHeight: \`\${metrics.height}px\`, clipPath: "none", pointerEvents: "none", zIndex: "0"
    };
    for (const [name, value] of Object.entries(styles)) {
      if (this.textarea.style[name] !== value) this.textarea.style[name] = value;
    }
  }
  focus() {
    this.isOpen && this.textarea && (this.positionInput(), this.textarea.focus({ preventScroll: true }));`
  )
  replace(
    '      const g = this.textarea;\n      this.canvas.addEventListener',
    '      const g = this.textarea;\n      g.addEventListener("keydown", () => this.positionInput(), { capture: true });\n      g.addEventListener("compositionstart", () => this.positionInput());\n      this.canvas.addEventListener'
  )
}
// Upgrade only the exact previously installed patch; never accept unknown edits.
if (
  source.startsWith(
    '// PNDS ghostty-web 0.4.0-next.21.g640db46 local compatibility patch v1'
  ) &&
  createHash('sha256').update(source).digest('hex') ===
    '8ad0305b961834412a1ca831adf11b78c42cea13784527e78253ee442624f596'
) {
  source = source.replace(
    '// PNDS ghostty-web 0.4.0-next.21.g640db46 local compatibility patch v1',
    marker
  )
  patchInputFocus()
  if (createHash('sha256').update(source).digest('hex') !== patchedDigest)
    throw new Error('Ghostty input-focus patch produced unexpected bytes')
  await writeFile(js, source)
}
if (
  source.startsWith(marker) &&
  createHash('sha256').update(source).digest('hex') !== patchedDigest
)
  throw new Error(
    'Previously patched Ghostty wrapper bytes do not match the pinned patch'
  )
if (!source.startsWith(marker)) {
  const digest = createHash('sha256').update(source).digest('hex')
  if (
    digest !==
    '457cb34280030cac3eb177707ccf838dc74577ba02d106f957f656df33ae8547'
  )
    throw new Error(`Unexpected Ghostty release bytes: ${digest}`)
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
    'else\n          N += " ";',
    'else if (!t || t.width !== 0)\n          N += " ";'
  )
  replace(
    'this.awaitingEcho && (this.awaitingEcho = !1, this.renderer && this.wasmTerm && this.renderer.render',
    'this.awaitingEcho && (this.awaitingEcho = !1, this.renderVisible !== false && this.renderer && this.wasmTerm && this.renderer.render'
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
  patchInputFocus()
  source = `${marker}\n${source}`
  if (createHash('sha256').update(source).digest('hex') !== patchedDigest)
    throw new Error('Ghostty compatibility patch produced unexpected bytes')
  await writeFile(js, source)
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
