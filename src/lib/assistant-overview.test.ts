import { expect, it } from 'vitest'
import { overviewConsumer } from './assistant-overview'
import type { AssistantProjectOverview } from './tauri-bindings'

const manifest = {
  path: 'manifest.json',
  version: 'manifest-v1',
  schemaVersion: 1,
  name: 'Work',
  scoreEntry: 'server.js',
  workingDirectory: '.',
  defaultAudioMode: 'internal' as const,
  outputChannels: 8,
  synthdefs: ['supercollider/synthdefs/voice.scsyndef'],
}
function overview(): AssistantProjectOverview {
  const text = `# 作品\n${'文档内容'.repeat(120)}\n## 音频架构\n${'more '.repeat(200)}`
  return {
    manifestStatus: 'valid',
    manifestMetadata: manifest,
    contentPaths: ['server.js'],
    snapshot: {
      fingerprint: 'saved',
      files: [
        {
          path: 'manifest.json',
          version: 'manifest-v1',
          bytes: 1000,
          reason: null,
        },
      ],
    },
    evidence: [
      {
        path: 'README.md',
        version: 'readme-v1',
        text: text.slice(0, 800),
        offset: 0,
        endOffset: 800,
        totalCharacters: text.length,
        nextOffset: 800,
        startLine: 1,
        endLine: 4,
      },
    ],
  }
}
function consume(data = overview()) {
  return overviewConsumer(
    data,
    'owner',
    { model: 'model', baseUrl: 'https://example.test' },
    'en',
    {
      staticContract: null,
      recentTest: null,
    }
  )
}

it('sends complete parsed manifest fields alongside bounded document excerpts and explicit navigation ranges', () => {
  const result = consume()
  const facts = JSON.parse(result.text).projectOverview
  expect(facts.manifestMetadata).toEqual(manifest)
  expect(facts.evidence[0].text.length).toBe(200)
  expect(facts.evidence[0].nextOffset).toBe(200)
  expect(facts.navigation[0]).toMatchObject({
    path: 'README.md',
    purpose: 'projectDocumentation',
    headingsInExcerpt: ['作品', '音频架构'],
    excerptRange: [0, 800],
    complete: false,
    readTarget: {
      path: 'README.md',
      version: 'readme-v1',
      offset: 0,
      pageLength: 32768,
    },
  })
  expect(result.sources?.[0]?.project?.text.length).toBe(200)
  expect(facts.note).toContain('not the full document')
})

it.each(['invalid', 'unreadable', 'valid'])(
  'does not promote stale or unavailable %s manifest metadata into facts',
  status => {
    const data = overview()
    data.manifestStatus = status
    data.snapshot.files = data.snapshot.files.map(file => ({
      ...file,
      version: 'changed',
    }))
    const facts = JSON.parse(consume(data).text).projectOverview
    expect(facts.manifestMetadata).toBeNull()
  }
)

it('supports absent files and old overview responses without inventing metadata', () => {
  const data = overview()
  delete data.manifestMetadata
  data.evidence = []
  const facts = JSON.parse(consume(data).text).projectOverview
  expect(facts.manifestMetadata).toBeNull()
  expect(facts.navigation).toEqual([])
})
