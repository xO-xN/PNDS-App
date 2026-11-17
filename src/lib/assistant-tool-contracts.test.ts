import { describe, expect, it } from 'vitest'
import manifest from '../../src-tauri/resources/assistant-tools.json'
import {
  availableAssistantTools,
  getAssistantToolContract,
  validateAssistantToolCall,
} from './assistant-tool-contracts'

const edit = { project: true, mode: 'edit' } as const
const parameter = {
  spec: {
    id: 'scale',
    path: 'public/monitor.js',
    prefix: 'const scale = ',
    suffix: ';',
    kind: 'number',
    preview: 'live',
    limits: { min: 0.1, max: 4, step: 0.1 },
  },
  current: 1,
}

describe('shared assistant tool contracts', () => {
  it('keeps the workflow card goal short and its complete facts in the public plan', () => {
    const handoff = getAssistantToolContract('propose_handoff')?.description
    expect(handoff).toContain('one short concrete goal sentence')
    expect(handoff).toContain(
      'complete plan and all design facts in the main reply'
    )
    expect(handoff).toContain('never unresolved creative choices')
  })
  it('explains Node shared-package resolution and the scope of observations during a live performance', () => {
    const library = getAssistantToolContract('use_local_library')?.description
    expect(library).toContain('NOT installed in project node_modules')
    expect(library).toContain('require(shared[id].path)')
    expect(library).toContain('createRequire(import.meta.url)')
    const check = getAssistantToolContract('run_project_check')?.description
    expect(check).toContain('read-only health/HTTP HEAD')
    expect(check).toContain('saved changes are not proven loaded')
  })
  it('describes existing-work preservation and limits controls to requested tuning without removing creation tools', () => {
    expect(
      getAssistantToolContract('create_project_file')?.description
    ).toContain('never invent a replacement artwork or demo')
    expect(
      getAssistantToolContract('write_project_file')?.description
    ).toContain('preserve the existing artwork')
    for (const name of ['install_preview_adapter', 'expose_project_parameters'])
      expect(getAssistantToolContract(name)?.description).toContain(
        'current task requests'
      )
    expect(
      getAssistantToolContract('run_project_check')?.description
    ).toContain('does not establish fidelity')
    expect(
      availableAssistantTools(edit).some(
        tool => tool.name === 'create_project_file'
      )
    ).toBe(true)
  })

  it('keeps the native manifest inside the supported validator schema subset', () => {
    const keywords = new Set([
      'type',
      'enum',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'pattern',
    ])
    const inspect = (schema: Record<string, unknown>) => {
      for (const keyword of Object.keys(schema))
        expect(keywords.has(keyword)).toBe(true)
      if (schema.properties)
        for (const property of Object.values(schema.properties))
          inspect(property as Record<string, unknown>)
      if (schema.items) inspect(schema.items as Record<string, unknown>)
    }
    expect(manifest.version).toBe(1)
    expect(new Set(manifest.tools.map(tool => tool.name)).size).toBe(
      manifest.tools.length
    )
    for (const tool of manifest.tools) inspect(tool.schema)
  })

  it('routes every advertised tool to its existing dispatcher and keeps modes separate', () => {
    const fixtures = {
      search_help: { query: 'preview' },
      read_help_section: { docId: 'preview', sectionId: 'controls' },
      propose_handoff: {
        reason: 'external work',
        intent: 'refactor',
        files: ['server.js'],
        plan: 'Refactor server.js and verify existing behavior.',
        knownProblems: '',
        acceptance: 'works',
      },
      complete_discussion: { answer: 'The host audio device emits sound.' },
      compile_synthdefs: {},
      run_project_tests: {},
      list_project_files: {},
      list_creation_materials: {},
      read_creation_material: {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        offset: 0,
        pageLength: 64,
      },
      search_project_text: { query: 'scale' },
      read_project_text: { path: 'public/monitor.js' },
      propose_text_change: {
        path: 'public/monitor.js',
        version: 'saved-version',
        parameters: [],
        text: 'const scale = 2;',
      },
      write_handoff: {
        path: 'docs/creator-handoff.md',
        version: null,
        text: 'Requirements',
      },
      write_project_file: {
        path: 'public/monitor.js',
        version: 'saved-version',
        edits: [{ oldText: 'const scale = 1;', newText: 'const scale = 2;' }],
      },
      run_project_static_check: {},
      remove_project_file: {
        path: 'public/obsolete.js',
        version: 'saved-version',
      },
      install_preview_adapter: {},
      expose_project_parameters: {
        path: 'public/monitor.js',
        version: 'saved-version',
        parameters: [parameter],
      },
      create_project_file: { path: 'public/new.js', text: 'export {}' },
      create_project_directory: { path: 'public/grid' },
      adopt_creation_material: {
        id: 'a'.repeat(32),
        version: 'b'.repeat(64),
        path: 'public/Grid.js',
      },
      complete_pending_integration: {
        sources: [
          {
            id: 'a'.repeat(32),
            version: 'b'.repeat(64),
            path: 'public/Grid.js',
          },
        ],
        targets: [{ path: 'public/Grid.js', version: 'saved-grid' }],
        checkTaskId: null,
      },
      use_local_library: { id: 'p5' },
      run_project_check: {},
      get_local_resources: {},
      propose_local_resources: {
        modules: ['players'],
        libraries: ['socket.io'],
        reason: 'Client identity recovery',
      },
      ask_question: {
        prompt: 'Which timing?',
        options: [],
        recommendedOptionId: null,
      },
      use_local_module: { id: 'players' },
    }
    const handlers = {
      documents: ['search_help', 'read_help_section'],
      materials: ['list_creation_materials', 'read_creation_material'],
      project: [
        'list_project_files',
        'search_project_text',
        'read_project_text',
      ],
      proposal: [
        'propose_handoff',
        'complete_discussion',
        'propose_text_change',
      ],
      task: [
        'write_handoff',
        'write_project_file',
        'run_project_static_check',
        'compile_synthdefs',
        'run_project_tests',
        'remove_project_file',
        'install_preview_adapter',
        'expose_project_parameters',
        'create_project_file',
        'create_project_directory',
        'adopt_creation_material',
        'complete_pending_integration',
        'use_local_library',
        'run_project_check',
        'get_local_resources',
        'propose_local_resources',
        'use_local_module',
        'ask_question',
      ],
    }
    const contexts = [
      { project: false },
      { project: true },
      { project: true, mode: 'discussion' },
      edit,
    ] as const
    for (const context of contexts)
      for (const contract of availableAssistantTools(context)) {
        expect(handlers[contract.handler]).toContain(contract.name)
        const fixture = fixtures[contract.name as keyof typeof fixtures]
        expect(fixture).toBeDefined()
        expect(
          validateAssistantToolCall(contract.name, fixture, context).ok
        ).toBe(true)
      }
    expect(
      availableAssistantTools({ project: false }).map(tool => tool.name)
    ).toEqual(handlers.documents)
    expect(
      availableAssistantTools({ project: true, mode: 'discussion' }).map(
        tool => tool.name
      )
    ).toEqual([
      ...handlers.documents,
      'propose_handoff',
      'complete_discussion',
      ...handlers.materials,
      ...handlers.project,
      'get_local_resources',
      'ask_question',
    ])
    expect(
      availableAssistantTools(edit).some(tool => tool.handler === 'proposal')
    ).toBe(false)
    expect(getAssistantToolContract('expose_project_parameters')?.effect).toBe(
      'parameter'
    )
    expect(getAssistantToolContract('run_project_check')?.effect).toBe('check')
  })

  it('returns actionable nested argument errors without echoing source values', () => {
    const result = validateAssistantToolCall(
      'expose_project_parameters',
      {
        path: 'public/monitor.js',
        parameters: [
          {
            ...parameter,
            spec: {
              ...parameter.spec,
              limits: { step: 'secret source' },
              extra: true,
            },
          },
        ],
        explanation: 'private source text',
      },
      edit
    )
    expect(result).toMatchObject({
      ok: false,
      result: {
        status: 'refused',
        reason: 'invalidToolArguments',
        issues: expect.arrayContaining([
          { path: '$.version', code: 'required', expected: 'required field' },
          {
            path: '$.parameters[0].spec.limits.step',
            code: 'type',
            expected: 'number | null',
          },
          expect.objectContaining({
            path: '$.parameters[0].spec.extra',
            code: 'unknownField',
          }),
          expect.objectContaining({
            path: '$.explanation',
            code: 'unknownField',
          }),
        ]),
        note: expect.stringContaining('Correct the listed fields'),
      },
    })
    expect(JSON.stringify(result)).not.toContain('secret source')
    expect(JSON.stringify(result)).not.toContain('private source text')
  })

  it('keeps missing/nullable write versions and optional null payloads unambiguous', () => {
    const original = {
      path: 'public/monitor.js',
      version: 'saved-version',
      text: 'const scale = 2;',
      edits: null,
    }
    const result = validateAssistantToolCall(
      'write_project_file',
      original,
      edit
    )
    expect(result).toMatchObject({
      ok: true,
      args: { text: 'const scale = 2;' },
    })
    if (result.ok) expect(result.args).not.toHaveProperty('edits')
    expect(original.edits).toBeNull()
    for (const version of [null, '', 42])
      expect(
        validateAssistantToolCall(
          'write_project_file',
          { ...original, version },
          edit
        ).ok
      ).toBe(false)
    expect(
      validateAssistantToolCall(
        'write_handoff',
        { ...original, version: null },
        { project: true, mode: 'discussion' }
      ).ok
    ).toBe(false)
    expect(
      validateAssistantToolCall(
        'create_project_file',
        { path: 'new.js', text: '', version: null },
        edit
      ).ok
    ).toBe(false)
  })

  it('accepts native nullable optional parameter bounds without inventing defaults', () => {
    const nullable = {
      ...parameter,
      spec: {
        ...parameter.spec,
        limits: {
          min: null,
          max: null,
          step: null,
          maxLength: null,
          options: [],
        },
      },
      suggestedMin: null,
      suggestedMax: null,
    }
    const result = validateAssistantToolCall(
      'expose_project_parameters',
      {
        path: 'public/monitor.js',
        version: 'saved-version',
        parameters: [nullable],
      },
      edit
    )
    expect(result).toMatchObject({ ok: true, args: { parameters: [nullable] } })
  })

  it('refuses mode-crossing or summary tools before dispatch', () => {
    expect(
      validateAssistantToolCall(
        'write_project_file',
        {},
        { project: true, mode: 'discussion' }
      )
    ).toMatchObject({ ok: false, result: { reason: 'toolUnavailable' } })
    expect(
      validateAssistantToolCall(
        'read_project_text',
        { path: 'score.js' },
        { project: false }
      )
    ).toMatchObject({ ok: false, result: { reason: 'toolUnavailable' } })
    expect(availableAssistantTools({ ...edit, purpose: 'summary' })).toEqual([])
    expect(
      validateAssistantToolCall(
        'search_help',
        { query: 'preview' },
        { ...edit, purpose: 'summary' }
      )
    ).toMatchObject({ ok: false, result: { reason: 'toolUnavailable' } })
    expect(
      validateAssistantToolCall('shell', { command: 'anything' }, edit)
    ).toMatchObject({ ok: false, result: { reason: 'unknownTool' } })
  })

  it('rejects out-of-range pages, arrays and enum types at the tool boundary', () => {
    expect(
      validateAssistantToolCall(
        'read_project_text',
        { path: 'score.js', pageLength: 65537 },
        edit
      ).ok
    ).toBe(false)
    expect(
      validateAssistantToolCall(
        'read_help_section',
        { docId: 'help', sectionId: 'intro', offset: 0.5 },
        edit
      ).ok
    ).toBe(false)
    expect(
      validateAssistantToolCall(
        'expose_project_parameters',
        {
          path: 'score.js',
          version: 'v',
          parameters: [
            { ...parameter, spec: { ...parameter.spec, preview: 'CDN' } },
          ],
        },
        edit
      ).ok
    ).toBe(false)
    expect(
      validateAssistantToolCall(
        'expose_project_parameters',
        {
          path: 'score.js',
          version: 'v',
          parameters: Array.from({ length: 17 }, () => parameter),
        },
        edit
      ).ok
    ).toBe(false)
    expect(validateAssistantToolCall('run_project_check', [], edit).ok).toBe(
      false
    )
  })
})

it.each([
  '',
  ' ',
  '/audio.js',
  '../audio.js',
  'public/../audio.js',
  'public//audio.js',
  'public/./audio.js',
  'C:\\audio.js',
])(
  'rejects a handoff file outside the shared relative-path contract: %s',
  path => {
    expect(
      validateAssistantToolCall(
        'propose_handoff',
        {
          reason: 'Ready',
          intent: 'Sustain touch',
          plan: 'Change audio.js and verify a held touch.',
          files: [path],
          knownProblems: '',
          acceptance: 'Held touch sustains.',
        },
        { project: true, mode: 'discussion' }
      ).ok
    ).toBe(false)
  }
)
