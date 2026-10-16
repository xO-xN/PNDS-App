import { expect, it, vi } from 'vitest'
import { installPreviewAdapter } from '../../src-tauri/resources/parameter-preview/adapter.mjs'
import { parameterValueValid } from './parameter-values'

it('changes actual page output, rejects undeclared values and restores its run baseline', async () => {
  const frame = globalThis.document.createElement('iframe')
  globalThis.document.body.append(frame)
  const page = frame.contentWindow
  page.document.body.innerHTML = '<output>Blue:2</output>'
  let speed = 2
  let title = 'Blue'
  const draw = () => {
    page.document.querySelector('output').textContent = `${title}:${speed}`
  }
  const reply = vi.spyOn(page.parent, 'postMessage').mockImplementation(vi.fn())
  const stop = installPreviewAdapter(
    {
      hostOrigin: 'http://host',
      sources: { 'score.js': 'sha256:source' },
      contractDigest: 'sha256:contract',
      parameters: {
        speed: {
          kind: 'number',
          limits: { min: 0, max: 10 },
          get: () => speed,
          set: value => {
            speed = value
            draw()
          },
        },
        title: {
          kind: 'text',
          limits: { maxLength: 16 },
          get: () => title,
          set: value => {
            title = value
            draw()
          },
        },
      },
    },
    page
  )
  const send = async (sequence, type, values) => {
    page.dispatchEvent(
      new page.MessageEvent('message', {
        source: page.parent,
        origin: 'http://host',
        data: {
          channel: 'pnds.preview',
          version: 1,
          session: 'test',
          sequence,
          type,
          values,
        },
      })
    )
    await vi.waitFor(() =>
      expect(reply.mock.calls.at(-1)?.[0].sequence).toBe(sequence)
    )
    return reply.mock.calls.at(-1)[0]
  }
  expect((await send(1, 'hello')).loaded).toEqual({
    'score.js': 'sha256:source',
  })
  expect((await send(2, 'set', { speed: 4, title: 'Amber' })).type).toBe(
    'applied'
  )
  expect(page.document.querySelector('output').textContent).toBe('Amber:4')
  expect((await send(3, 'set', { speed: 11 })).type).toBe('error')
  expect((await send(4, 'set', { shell: 'launch' })).type).toBe('error')
  expect((await send(5, 'restore')).type).toBe('restored')
  expect(page.document.querySelector('output').textContent).toBe('Blue:2')
  stop()
  frame.remove()
  reply.mockRestore()
})

it('keeps immediate UI constraints in parity with the shipped adapter at its public message boundary', async () => {
  const cases = [
    {
      kind: 'number',
      limits: { min: 0, max: 10, step: 2 },
      baseline: 2,
      trials: [
        [4, true],
        [3, false],
        [12, false],
        ['4', false],
      ],
    },
    {
      kind: 'boolean',
      limits: {},
      baseline: false,
      trials: [
        [true, true],
        [0, false],
      ],
    },
    {
      kind: 'text',
      limits: { maxLength: 2 },
      baseline: 'A',
      trials: [
        ['😀', true],
        ['long', false],
      ],
    },
    {
      kind: 'color',
      limits: {},
      baseline: '#112233',
      trials: [
        ['#abcdef', true],
        ['red', false],
      ],
    },
    {
      kind: 'option',
      limits: { options: ['', 'Blue'] },
      baseline: 'Blue',
      trials: [
        ['', true],
        ['Red', false],
      ],
    },
  ]
  for (const fixture of cases) {
    const frame = globalThis.document.createElement('iframe')
    globalThis.document.body.append(frame)
    const page = frame.contentWindow
    let current = fixture.baseline
    const reply = vi
      .spyOn(page.parent, 'postMessage')
      .mockImplementation(vi.fn())
    const stop = installPreviewAdapter(
      {
        hostOrigin: 'http://host',
        sources: {},
        contractDigest: 'c',
        parameters: {
          value: {
            ...fixture,
            get: () => current,
            set: value => {
              current = value
            },
          },
        },
      },
      page
    )
    let sequence = 0
    const send = async (type, values) => {
      const expected = ++sequence
      page.dispatchEvent(
        new page.MessageEvent('message', {
          source: page.parent,
          origin: 'http://host',
          data: {
            channel: 'pnds.preview',
            version: 1,
            session: 'parity',
            sequence: expected,
            type,
            values,
          },
        })
      )
      await vi.waitFor(() =>
        expect(reply.mock.calls.at(-1)?.[0].sequence).toBe(expected)
      )
      return reply.mock.calls.at(-1)[0]
    }
    await send('hello')
    for (const [value, accepted] of fixture.trials) {
      expect(
        parameterValueValid(
          { kind: fixture.kind, limits: fixture.limits },
          value
        )
      ).toBe(accepted)
      expect((await send('set', { value })).type).toBe(
        accepted ? 'applied' : 'error'
      )
    }
    stop()
    reply.mockRestore()
    frame.remove()
  }
})
