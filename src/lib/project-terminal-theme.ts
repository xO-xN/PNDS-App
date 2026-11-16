import type { ITheme } from 'ghostty-web'

/** Snapshot the actual App palette once, before loading a new terminal. */
export function projectTerminalTheme(): ITheme {
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
  )
}
