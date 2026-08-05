// Multichannel Tone Test unit tests: frequency math, gain mapping, and tone/master
// boundary rules. No audio device, no network — pure functions only.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { AudioEngine, toneFrequency, faderValueToGain } = require('../lib/audio-engine')
const { OscClient } = require('../lib/osc')

test('toneFrequency steps each channel up by a semitone from 440 Hz', () => {
  assert.ok(Math.abs(toneFrequency(1) - 440) < 1e-9)
  assert.ok(Math.abs(toneFrequency(2) - 440 * Math.pow(2, 1 / 12)) < 1e-9)
  assert.ok(Math.abs(toneFrequency(3) - 440 * Math.pow(2, 2 / 12)) < 1e-9)
  assert.ok(Math.abs(toneFrequency(16) - 440 * Math.pow(2, 15 / 12)) < 1e-9)
  // Channel 13 (12 semitones up) is exactly an octave: 880 Hz.
  assert.ok(Math.abs(toneFrequency(13) - 880) < 1e-9)
})

test('faderValueToGain maps 0 to mute and clamps to [-60, 0] dBFS', () => {
  assert.equal(faderValueToGain(0), 0)
  assert.equal(faderValueToGain(-1), 0) // clamped
  assert.ok(Math.abs(faderValueToGain(1) - 1.0) < 1e-9) // 0 dBFS = unity
  assert.ok(Math.abs(faderValueToGain(0.5) - 10 ** (-30 / 20)) < 1e-9) // -30 dBFS
  assert.ok(Math.abs(faderValueToGain(1.5) - 1.0) < 1e-9) // clamped to unity
})

test('faderValueToGain is monotonic in the fader range', () => {
  let previous = -1
  for (let step = 0; step <= 100; step += 1) {
    const gain = faderValueToGain(step / 100)
    assert.ok(gain >= previous, `gain regressed at step ${step}`)
    previous = gain
  }
})

/** A recording OSC client: captures every message, never sends. */
class FakeOscClient {
  constructor() {
    this.messages = []
  }
  async send(address, ...args) {
    this.messages.push({ address, args })
  }
  async waitForReply() {}
  async close() {}
}

test('tones start muted; toggling applies master gain to that tone only', async () => {
  const client = new FakeOscClient()
  const engine = new AudioEngine({ client, outputBus: 8, outputChannels: 16 })

  assert.ok(engine.tones.every(tone => !tone.on))
  assert.equal(engine.effectiveGain(engine.tones[0]), 0)

  // Toggle channel 1 on: gain jumps to the master level.
  await engine.setTone(1, true)
  assert.equal(engine.tones[0].on, true)
  const setMsg = client.messages.find(m => m.address === '/n_set' && m.args[0] === 1001)
  assert.ok(setMsg, 'expected an /n_set for tone 1')
  assert.equal(setMsg.args[2], engine.masterGain)

  // Other tones stay silent.
  assert.ok(engine.tones.slice(1).every(tone => !tone.on))

  // Toggle off again: gain -> 0.
  await engine.setTone(1, false)
  assert.equal(engine.tones[0].on, false)
  const offMsg = client.messages.filter(m => m.address === '/n_set' && m.args[0] === 1001).pop()
  assert.equal(offMsg.args[2], 0)
})

test('master volume pushes only to active tones; off tones stay silent', async () => {
  const client = new FakeOscClient()
  const engine = new AudioEngine({ client, outputBus: 8, outputChannels: 16 })

  await engine.setTone(3, true)
  client.messages.length = 0 // clear the toggle messages

  await engine.setMasterGain(0.5)
  const expectedGain = faderValueToGain(0.5)
  assert.equal(engine.masterGain, expectedGain)
  // Only tone 3 (node 1003) received the new gain.
  const sets = client.messages.filter(m => m.address === '/n_set')
  assert.equal(sets.length, 1)
  assert.equal(sets[0].args[0], 1003)
  assert.equal(sets[0].args[2], expectedGain)
  // toneState reflects effective gains.
  const state = engine.toneState()
  assert.equal(state[2].on, true)
  assert.equal(state[2].gain, expectedGain)
  assert.equal(state[0].gain, 0)
})

test('FakeOscClient records full messages (test harness sanity)', async () => {
  const client = new FakeOscClient()
  await client.send('/n_set', 1001, 'gain', 0.5)
  assert.deepEqual(client.messages, [{ address: '/n_set', args: [1001, 'gain', 0.5] }])
})

test('OscClient constructor validates the target', () => {
  assert.throws(() => new OscClient({ host: '', port: 1 }), /Invalid OSC target/)
  assert.throws(() => new OscClient({ host: '127.0.0.1', port: 0 }), /Invalid OSC target/)
  assert.throws(() => new OscClient({ host: '127.0.0.1', port: 70000 }), /Invalid OSC target/)
})

