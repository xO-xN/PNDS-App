// OSC encoder known-byte fixtures. The encoder replicates osc-min's
// exact wire format (padding = 4 - (len % 4) NULs, always appended — so a
// 4-char string becomes 8 bytes), which is what the bundled scsynth
// parses. Every fixture asserts byte-for-byte equality with osc-min's
// reference output.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const osc = require('/Users/xiaoxiang/Coding/PNDS app 开发/Inarticulate III/node_modules/osc-min')

const { encodeMessage } = require('../lib/osc')

const SYNTHDEF_PATH =
  '/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-App-main/examples/Multichannel Signal Generator/supercollider/synthdefs/multichannel-signal-generator.scsyndef'

test('encodeMessage /d_load matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/d_load', [SYNTHDEF_PATH])
  const ref = osc.toBuffer({ address: '/d_load', args: [SYNTHDEF_PATH] })
  assert.deepEqual(mine, ref)
})

test('encodeMessage /g_new matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/g_new', [1000, 1, 0])
  const ref = osc.toBuffer({ address: '/g_new', args: [1000, 1, 0] })
  assert.deepEqual(mine, ref)
})

test('encodeMessage /s_new matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/s_new', [
    'toneTest', 1001, 1, 1000, 'freq', 110, 'gain', 0, 'out', 16,
  ])
  const ref = osc.toBuffer({
    address: '/s_new',
    args: ['toneTest', 1001, 1, 1000, 'freq', 110, 'gain', 0, 'out', 16],
  })
  assert.deepEqual(mine, ref)
})

test('encodeMessage /n_set matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/n_set', [1001, 'gain', 0.5])
  const ref = osc.toBuffer({ address: '/n_set', args: [1001, 'gain', 0.5] })
  assert.deepEqual(mine, ref)
})

test('encodeMessage /sync matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/sync', [1])
  const ref = osc.toBuffer({ address: '/sync', args: [1] })
  assert.deepEqual(mine, ref)
})

test('encodeMessage /g_freeAll matches osc-min byte-for-byte', () => {
  const mine = encodeMessage('/g_freeAll', [1000])
  const ref = osc.toBuffer({ address: '/g_freeAll', args: [1000] })
  assert.deepEqual(mine, ref)
})

test('encodeMessage rejects a non-slash address', () => {
  assert.throws(() => encodeMessage('n_set', []), /must start with '\/'/)
})
