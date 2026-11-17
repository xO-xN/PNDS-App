import { describe, expect, it } from 'vitest'
import { prepareAssistantProposal } from './assistant-proposals'
import { projectPageSource } from './assistant-project'
import { AssistantReadEvidence } from './assistant-reading-evidence'
import type { AssistantSource } from './assistant-types'

const text = `// ${'score '.repeat(5000)}\nconst tempo = 80;\nconst color = 'red';\n`
const scope = {
  fingerprint: 'saved',
  files: [
    {
      path: 'public/monitor.js',
      version: 'v1',
      bytes: text.length,
      reason: null,
    },
  ],
}
const sources = [
  projectPageSource(
    {
      path: 'public/monitor.js',
      version: 'v1',
      text,
      offset: 0,
      endOffset: text.length,
      totalCharacters: text.length,
      nextOffset: null,
      startLine: 1,
      endLine: 4,
    },
    'en'
  ),
]
const evidence = (values: readonly AssistantSource[] = sources) =>
  new AssistantReadEvidence(values).view()
const proposal = (edits: unknown) => ({
  path: 'public/monitor.js',
  version: 'v1',
  edits,
  parameters: [],
})

describe('saved-text patch proposals', () => {
  it('changes a large saved file through small exact replacements and preserves every other byte', async () => {
    const result = await prepareAssistantProposal(
      proposal([
        { oldText: 'const tempo = 80;', newText: 'const tempo = 96;' },
        { oldText: "const color = 'red';", newText: "const color = 'blue';" },
      ]),
      evidence(),
      scope
    )
    expect(result?.text).toBe(
      text.replace('80;', '96;').replace("'red'", "'blue'")
    )
    expect(result?.sourceText).toBe(text)
  })

  it.each([
    [{ oldText: 'missing', newText: 'x' }],
    [{ oldText: 'score ', newText: 'x' }],
    [{ oldText: '', newText: 'x' }],
    [
      { oldText: '80;', newText: '96;' },
      { oldText: '80', newText: '100' },
    ],
    [{ oldText: '80;', newText: '96;', extra: true }],
  ])(
    'rejects absent, ambiguous, overlapping or malformed replacement anchors: %j',
    async (...edits) => {
      expect(
        await prepareAssistantProposal(proposal(edits), evidence(), scope)
      ).toBeNull()
    }
  )

  it('still requires the complete saved version and exactly one proposal representation', async () => {
    const args = proposal([{ oldText: '80;', newText: '96;' }])
    expect(await prepareAssistantProposal(args, evidence([]), scope)).toBeNull()
    expect(
      await prepareAssistantProposal(
        { ...args, text: 'replacement' },
        evidence(),
        scope
      )
    ).toBeNull()
    expect(
      await prepareAssistantProposal(
        { ...args, version: 'stale' },
        evidence(),
        scope
      )
    ).toBeNull()
  })

  it.each(['saved', 'draft', 'proposal'] as const)(
    'does not treat an explicit %s attachment selection as the complete saved file',
    async source => {
      const fragment = 'const tempo = 80;'
      const attachment = projectPageSource(
        {
          path: 'public/monitor.js',
          version: 'v1',
          source,
          text: fragment,
          offset: 0,
          endOffset: fragment.length,
          totalCharacters: fragment.length,
          nextOffset: null,
          startLine: 2,
          endLine: 2,
        },
        'en'
      )
      const args = proposal([
        { oldText: fragment, newText: 'const tempo = 96;' },
      ])
      expect(
        await prepareAssistantProposal(args, evidence([attachment]), scope)
      ).toBeNull()
      const result = await prepareAssistantProposal(
        args,
        evidence([...sources, attachment]),
        scope
      )
      expect(result?.sourceText).toBe(text)
      expect(result?.text).toBe(text.replace(fragment, 'const tempo = 96;'))
    }
  )
})
