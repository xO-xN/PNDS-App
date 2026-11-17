import type { ITheme } from 'ghostty-web'

/** Read the Host palette; each surface snapshots after font/WASM loading. */
export function projectTerminalTheme(): Required<ITheme> {
  const style = getComputedStyle(document.documentElement)
  const slots = [
    'foreground',
    'background',
    'cursor',
    'cursorAccent',
    'selectionBackground',
    'selectionForeground',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite',
  ] as const
  return Object.fromEntries(
    slots.map(slot => [
      slot,
      style
        .getPropertyValue(
          `--pnds-terminal-${slot.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
        )
        .trim(),
    ])
  ) as Required<ITheme>
}
