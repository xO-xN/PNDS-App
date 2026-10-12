import { describe, expect, it } from 'vitest'
import {
  parseManifestFormModel,
  writeManifestField,
  writeManifestSupportedModes,
} from './creation-manifest-form'

const declarationWithUnknowns = `{
  "schemaVersion": 1,
  "id": "inarticulate-iii",
  "name": "Inarticulate III",
  "version": "1.0.1",
  "description": "A networked digital score.",
  "telematic": false,
  "performerAddress": "mywork.local",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869,
    "supportsPerformerUrl": true,
    "needsHttps": true,
    "routes": { "/health": "stub" }
  },
  "roles": ["alpha", "beta"],
  "audio": {
    "defaultMode": "internal",
    "supportedModes": ["internal", "external"],
    "outputChannels": 2,
    "synthdefs": ["supercollider/synthdefs/a.scsyndef"],
    "scsynth": { "sampleRate": 96000, "blockSize": 64, "audioBusChannels": 128 },
    "standaloneTarget": "127.0.0.1:57110"
  }
}`

describe('creation manifest form model (#158)', () => {
  it('reads the editable declarations from the draft text', () => {
    const model = parseManifestFormModel(declarationWithUnknowns)
    expect(model).toMatchObject({
      name: 'Inarticulate III',
      id: 'inarticulate-iii',
      version: '1.0.1',
      description: 'A networked digital score.',
      defaultMode: 'internal',
      supportedModes: ['internal', 'external'],
      outputChannels: '2',
      audioBusChannels: '128',
      blockSize: '64',
      synthdefs: 'supercollider/synthdefs/a.scsyndef',
      entry: 'server.js',
      workingDirectory: '.',
      monitorPort: '6869',
      performerPort: '6868',
      telematic: false,
      performerAddress: 'mywork.local',
      standaloneTarget: '127.0.0.1:57110',
    })
  })

  it('shows the effective default for an absent outputChannels', () => {
    const model = parseManifestFormModel(
      '{"audio": {"supportedModes": ["none"]}}'
    )
    expect(model?.outputChannels).toBe('2')
    expect(model?.audioBusChannels).toBe('')
  })

  it('rejects texts that are not JSON objects', () => {
    expect(parseManifestFormModel('not json')).toBeNull()
    expect(parseManifestFormModel('[1, 2]')).toBeNull()
    expect(parseManifestFormModel('7')).toBeNull()
    expect(writeManifestField('[1]', 'name', 'x')).toBeNull()
    expect(writeManifestField('nope', 'name', 'x')).toBeNull()
  })

  it('round-trips unrecognized fields and unedited lenient declarations untouched', () => {
    const next = writeManifestField(declarationWithUnknowns, 'name', 'Renamed')
    expect(next).not.toBeNull()
    const written = JSON.parse(next as string)
    expect(written.name).toBe('Renamed')
    // Unknown / out-of-form fields survive byte-for-byte in value.
    expect(written.schemaVersion).toBe(1)
    expect(written.roles).toEqual(['alpha', 'beta'])
    expect(written.scoreServer.routes).toEqual({ '/health': 'stub' })
    expect(written.scoreServer.supportsPerformerUrl).toBe(true)
    expect(written.scoreServer.needsHttps).toBe(true)
    expect(written.audio.scsynth.sampleRate).toBe(96000)
    expect(written.telematic).toBe(false)
    expect(written.audio.standaloneTarget).toBe('127.0.0.1:57110')
    // Two-space JSON with a trailing newline, whatever the source layout.
    expect(next).toMatch(/\n {2}"name": "Renamed",\n/)
    expect(next?.endsWith('}\n')).toBe(true)
  })

  it('writes numbers only when the field holds a non-negative integer', () => {
    expect(
      JSON.parse(
        writeManifestField(declarationWithUnknowns, 'monitorPort', '6870') ??
          '{}'
      ).scoreServer.monitorPort
    ).toBe(6870)
    // Garbage or blank removes the key instead of silently keeping a stale
    // number — the save gate then names the missing field.
    expect(
      JSON.parse(
        writeManifestField(declarationWithUnknowns, 'monitorPort', '68a') ??
          '{}'
      ).scoreServer.monitorPort
    ).toBeUndefined()
    expect(
      JSON.parse(
        writeManifestField(declarationWithUnknowns, 'blockSize', '') ?? '{}'
      ).audio.scsynth.blockSize
    ).toBeUndefined()
  })

  it('creates missing nested sections when a declaration is first edited', () => {
    const minimal =
      '{"schemaVersion": 1, "id": "x", "name": "X", "version": "1.0.0"}'
    const next = JSON.parse(
      writeManifestField(minimal, 'performerPort', '7000') ?? '{}'
    )
    expect(next.scoreServer.performerPort).toBe(7000)
  })

  it('edits standaloneTarget inside audio per the manifest contract', () => {
    const next = JSON.parse(
      writeManifestField(
        declarationWithUnknowns,
        'standaloneTarget',
        '127.0.0.1:57120'
      ) ?? '{}'
    )
    expect(next.audio.standaloneTarget).toBe('127.0.0.1:57120')
    expect(next.standaloneTarget).toBeUndefined()
    const cleared = JSON.parse(
      writeManifestField(declarationWithUnknowns, 'standaloneTarget', ' ') ??
        '{}'
    )
    expect(cleared.audio.standaloneTarget).toBeUndefined()
  })

  it('filters SynthDef lines and drops the declaration when none remain', () => {
    const two = writeManifestField(
      declarationWithUnknowns,
      'synthdefs',
      'a.scsyndef\n\n  b.scsyndef  \n'
    )
    expect(JSON.parse(two ?? '{}').audio.synthdefs).toEqual([
      'a.scsyndef',
      'b.scsyndef',
    ])
    const cleared = writeManifestField(
      declarationWithUnknowns,
      'synthdefs',
      '\n \n'
    )
    expect(JSON.parse(cleared ?? '{}').audio.synthdefs).toBeUndefined()
  })

  it('clearing telematic returns the project to undeclared, not false', () => {
    const on = writeManifestField(declarationWithUnknowns, 'telematic', true)
    expect(JSON.parse(on ?? '{}').telematic).toBe(true)
    const off = writeManifestField(on ?? '', 'telematic', false)
    expect(JSON.parse(off ?? '{}').telematic).toBeUndefined()
  })

  it('clearing optional strings removes the declaration', () => {
    const next = JSON.parse(
      writeManifestField(declarationWithUnknowns, 'performerAddress', '  ') ??
        '{}'
    )
    expect(next.performerAddress).toBeUndefined()
    expect(
      JSON.parse(
        writeManifestField(
          declarationWithUnknowns,
          'description',
          'New summary'
        ) ?? '{}'
      ).description
    ).toBe('New summary')
  })

  it('writes the supported mode set in canonical order, keeping an explicit empty selection', () => {
    const next = writeManifestSupportedModes(declarationWithUnknowns, [
      'none',
      'external',
    ])
    expect(JSON.parse(next ?? '{}').audio.supportedModes).toEqual([
      'external',
      'none',
    ])
    const none = writeManifestSupportedModes(declarationWithUnknowns, [])
    expect(JSON.parse(none ?? '{}').audio.supportedModes).toEqual([])
  })
})
