import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  info as pluginInfo,
  warn as pluginWarn,
  error as pluginError,
} from '@tauri-apps/plugin-log'
import { logger } from './logger'

/**
 * v1.2.0 (issue #13): every frontend log entry is forwarded to
 * tauri-plugin-log so it lands in the app log file (~2MB rotation), with
 * context serialized onto the line.
 */
describe('logger (log plugin forwarding)', () => {
  beforeEach(() => {
    vi.mocked(pluginInfo).mockClear()
    vi.mocked(pluginWarn).mockClear()
    vi.mocked(pluginError).mockClear()
  })

  it('forwards each level to the matching plugin function', () => {
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(vi.mocked(pluginInfo)).toHaveBeenCalledWith('i')
    expect(vi.mocked(pluginWarn)).toHaveBeenCalledWith('w')
    expect(vi.mocked(pluginError)).toHaveBeenCalledWith('e')
  })

  it('appends JSON-serialized context to the line', () => {
    logger.info('Session started', { path: '/tmp/x' })
    expect(vi.mocked(pluginInfo)).toHaveBeenCalledWith(
      'Session started {"path":"/tmp/x"}'
    )
  })

  it('keeps the line bare when no context is given', () => {
    logger.warn('no context')
    expect(vi.mocked(pluginWarn)).toHaveBeenCalledWith('no context')
  })

  it('never throws when the IPC sink rejects (e.g. outside Tauri)', () => {
    vi.mocked(pluginError).mockRejectedValueOnce(new Error('no IPC'))
    expect(() => logger.error('boom', { a: 1 })).not.toThrow()
  })
})
