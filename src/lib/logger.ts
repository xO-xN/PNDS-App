/**
 * Logging utility for the frontend.
 *
 * Every entry is forwarded to tauri-plugin-log (v1.2.0, issue #13), which
 * owns the on-disk targets — stdout, the app log file (~2MB rotation) and
 * the webview console. The production log level on the Rust side is Info,
 * so trace/debug entries only reach disk in development builds. In
 * development this logger additionally prints to the browser console with
 * the raw, expandable context object.
 */

import {
  trace as pluginTrace,
  debug as pluginDebug,
  info as pluginInfo,
  warn as pluginWarn,
  error as pluginError,
} from '@tauri-apps/plugin-log'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: Date
  context?: Record<string, unknown>
}

const pluginSenders: Record<LogLevel, (line: string) => Promise<void>> = {
  trace: pluginTrace,
  debug: pluginDebug,
  info: pluginInfo,
  warn: pluginWarn,
  error: pluginError,
}

class Logger {
  private isDevelopment = import.meta.env.DEV

  /**
   * Log a trace message (most verbose)
   */
  trace(message: string, context?: Record<string, unknown>): void {
    this.log('trace', message, context)
  }

  /**
   * Log a debug message (development only)
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context)
  }

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context)
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
    }

    // Always log to console in development
    if (this.isDevelopment) {
      this.logToConsole(entry)
    }

    this.logToBackend(entry)
  }

  private logToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString()
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`

    const args = entry.context
      ? [prefix, entry.message, entry.context]
      : [prefix, entry.message]

    switch (entry.level) {
      case 'trace':
      case 'debug':
        console.debug(...args)
        break
      case 'info':
        console.info(...args)
        break
      case 'warn':
        console.warn(...args)
        break
      case 'error':
        console.error(...args)
        break
    }
  }

  /**
   * Forward the entry to tauri-plugin-log. Fire-and-forget: logging must
   * never block callers, and a dropped line (e.g. IPC unavailable in a
   * non-Tauri test environment) is not worth surfacing.
   */
  private logToBackend(entry: LogEntry): void {
    const line =
      entry.context !== undefined
        ? `${entry.message} ${formatContext(entry.context)}`
        : entry.message
    pluginSenders[entry.level](line).catch(() => {
      /* IPC unavailable (unit tests / pre-Tauri shell) — nothing to do */
    })
  }
}

/** Serialize a context object onto the log line; never throws, even for
 * cyclic or exotic values. */
function formatContext(context: Record<string, unknown>): string {
  try {
    return JSON.stringify(context)
  } catch {
    return '[unserializable context]'
  }
}

// Export a singleton logger instance
export const logger = new Logger()

// Export individual logging functions for convenience
export const { trace, debug, info, warn, error } = logger
