import i18n from '@/i18n/config'
import type { ProjectTerminalTaskContext } from '@/lib/tauri-bindings'

/** Quoted examples are documentation; no task text is executed by the App. */
function shellQuote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`
}

export function terminalTaskDocument(
  task: { intent: string; files: string[]; acceptance: string },
  context: ProjectTerminalTaskContext,
  language: string
): string {
  return i18n.getFixedT(language)('creation.terminal.taskDocument', {
    intent: task.intent,
    files: task.files.map(file => `- ${file}`).join('\n'),
    acceptance: task.acceptance,
    projectRoot: JSON.stringify(context.projectRoot),
    documentationRoot: JSON.stringify(context.documentationRoot),
    checkCommand: `${shellQuote(context.checkerPath)} check ${shellQuote(context.projectRoot)} --json`,
    checkHelp: `${shellQuote(context.checkerPath)} check --help`,
  })
}
