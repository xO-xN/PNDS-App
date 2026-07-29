import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from './project-store'
import type { Manifest } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

describe('project-store', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [],
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('starts untrusted and idle', () => {
    expect(useProjectStore.getState().isTrusted('/any/path')).toBe(false)
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
  })

  it('trusts a project path once confirmed (§4)', () => {
    useProjectStore.getState().trustProject('/Users/test/Project')
    expect(useProjectStore.getState().isTrusted('/Users/test/Project')).toBe(
      true
    )

    // Trusting again must not duplicate the entry
    useProjectStore.getState().trustProject('/Users/test/Project')
    expect(useProjectStore.getState().trustedPaths).toHaveLength(1)
  })

  it('tracks the preflight lifecycle', () => {
    useProjectStore.getState().startPreflight()
    expect(useProjectStore.getState().preflightStatus).toBe('checking')

    useProjectStore.getState().preflightSucceeded('/p', manifest)
    const state = useProjectStore.getState()
    expect(state.preflightStatus).toBe('ready')
    expect(state.currentProject?.manifest.name).toBe('Inarticulate III')
    expect(state.preflightError).toBeNull()
  })

  it('records a readable error and clears the project on failure', () => {
    useProjectStore.getState().preflightSucceeded('/p', manifest)
    useProjectStore
      .getState()
      .preflightFailed('manifest.json missing required field')
    const state = useProjectStore.getState()
    expect(state.preflightStatus).toBe('error')
    expect(state.preflightError).toContain('missing required field')
    expect(state.currentProject).toBeNull()
  })

  it('clearProject resets the session state but keeps trust', () => {
    useProjectStore.getState().trustProject('/p')
    useProjectStore.getState().preflightSucceeded('/p', manifest)
    useProjectStore.getState().clearProject()
    const state = useProjectStore.getState()
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
    expect(state.isTrusted('/p')).toBe(true)
  })
})
