import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { Ghostty } from 'ghostty-web'

it('reuses grown Unicode history pages without continued WASM memory growth', async () => {
  const bytes = await readFile('src/assets/project-terminal/ghostty-vt.wasm')
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      log() {
        /* The real WASM logger is silent in this fixture. */
      },
    },
  })
  const memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory))
    throw new Error('WASM memory is missing')
  const terminal = new Ghostty(instance).createTerminal(80, 24, {
    scrollbackLimit: 1024 * 1024,
  })
  let capacityAfterWarmup = 0
  try {
    for (let line = 1; line <= 100000; line++) {
      terminal.write('👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n')
      if (line % 64 === 0) {
        terminal.update()
        terminal.getViewport()
        terminal.markClean()
      }
      if (line === 50000) capacityAfterWarmup = memory.buffer.byteLength
    }
    expect(memory.buffer.byteLength).toBe(capacityAfterWarmup)
    expect(terminal.getScrollbackLength()).toBeLessThan(10000)
  } finally {
    terminal.free()
  }
})
