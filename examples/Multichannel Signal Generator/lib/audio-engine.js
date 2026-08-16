// Multichannel Signal Generator audio engine: owns one scsynth group with
// 16 mono `toneTest` instances — one per private output bus.
//
// Contract (§3, §6, §8, §11):
//   - reads PNDS_AUDIO_OUTPUT_BUS (first private bus) and
//     PNDS_AUDIO_OUTPUT_CHANNELS (host-declared channel count)
//   - each tone writes ONLY its own mono bus; never hardware bus 0,
//     never downmixes
//   - the project owns and releases its group and its 16 synths; the App
//     master stage only bridges private buses to hardware
//   - every fader value maps to a linear gain with ~20ms smoothing (the
//     SynthDef's Lag.kr) — no clicks

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const GROUP_ID = 1000 // project-owned group (below the App reserved range)
const SYNTH_BASE = 1001 // instances 1001..1016
const TONE_COUNT = 16
const BASE_FREQUENCY = 440 // Hz, channel 1 (concert A)
const MUTE_GAIN = 0.0
const MAX_GAIN = 10 ** (0 / 20) // 0 dBFS (unity)
const DEFAULT_MASTER_GAIN = 10 ** (-6 / 20) // -6 dBFS

/**
 * Frequency for channel `index` (1-based): semitone steps above 440 Hz.
 *   f_n = 440 * 2^((n-1)/12)
 */
function toneFrequency(index) {
  return BASE_FREQUENCY * Math.pow(2, (index - 1) / 12)
}

/**
 * Linear gain for a master-volume value 0..1. Maps to dBFS in [-60, 0];
 * 0 = silent, 1 = unity (0 dBFS). Applied to every active tone.
 */
function faderValueToGain(value) {
  const v = Math.min(1, Math.max(0, Number(value)))
  if (v === 0) return MUTE_GAIN
  const db = -60 + v * 60 // -60 dBFS .. 0 dBFS
  return 10 ** (db / 20)
}

class AudioEngine {
  /**
   * @param {import('./osc').OscClient} client  connected OSC client
   * @param {number} outputBus   PNDS_AUDIO_OUTPUT_BUS
   * @param {number} outputChannels PNDS_AUDIO_OUTPUT_CHANNELS
   */
  constructor({ client, outputBus, outputChannels }) {
    this.client = client
    this.outputBus = outputBus
    this.outputChannels = outputChannels
    this.masterGain = DEFAULT_MASTER_GAIN // fader defaults to -6 dBFS
    this.tones = Array.from({ length: TONE_COUNT }, (_, index) => ({
      channel: index + 1,
      nodeId: SYNTH_BASE + index,
      bus: outputBus + index,
      freq: toneFrequency(index + 1),
      on: false, // all tones start muted
    }))
  }

  /** Loads the synthdef, creates the group and all 16 instances. Each
   *  step waits for scsynth's confirmation. The /done from /d_load does
   *  NOT guarantee the def is queryable yet — scsynth finishes the file
   *  load asynchronously and /s_new sent right after /done can still fail
   *  with "SynthDef not found" (observed against the bundled SC 3.14.1).
   *  A /sync barrier after /d_load closes that window. */
  async start() {
    const synthdefPath = path.join(
      __dirname,
      '..',
      'supercollider',
      'synthdefs',
      'multichannel-signal-generator.scsyndef'
    )
    await this.client.send('/d_load', synthdefPath)
    await this.client.waitForReply('/done', 5000)
    // Barrier: /synced confirms the def is usable by the time it returns.
    await this.client.send('/sync')
    await this.client.waitForReply('/synced', 5000)
    await this.client.send(
      '/g_new',
      GROUP_ID,
      1, // add to tail of root group (0)
      0
    )
    for (const tone of this.tones) {
      await this.client.send(
        '/s_new',
        'toneTest',
        tone.nodeId,
        1, // add to tail of the group
        GROUP_ID,
        'freq',
        tone.freq,
        'gain',
        this.effectiveGain(tone), // all tones start muted
        'out',
        tone.bus
      )
    }
    // Wait for the whole queue to be processed before reporting ready.
    await this.client.send('/sync')
    await this.client.waitForReply('/synced', 5000)
  }

  /** Actual gain sent to scsynth for `tone`: on ? master : 0. */
  effectiveGain(tone) {
    return tone.on ? this.masterGain : MUTE_GAIN
  }

  /**
   * Toggles `channel` (1-based) on/off. On = master gain; off = mute.
   */
  async setTone(channel, on) {
    const tone = this.tones[channel - 1]
    if (!tone) throw new RangeError(`No tone for channel ${channel}`)
    tone.on = Boolean(on)
    await this.client.send('/n_set', tone.nodeId, 'gain', this.effectiveGain(tone))
  }

  /**
   * Sets the master volume fader (0..1, dBFS in [-60, 0]) and pushes it
   * to every tone (off tones stay silent).
   */
  async setMasterGain(value) {
    this.masterGain = faderValueToGain(value)
    for (const tone of this.tones) {
      if (tone.on) {
        await this.client.send('/n_set', tone.nodeId, 'gain', this.masterGain)
      }
    }
  }

  /** Snapshot for the monitor page /api/state. */
  toneState() {
    return this.tones.map(tone => ({
      channel: tone.channel,
      bus: tone.bus,
      freq: tone.freq,
      on: tone.on,
      gain: this.effectiveGain(tone),
    }))
  }

  /** Releases the whole group (and with it all 16 instances) and closes
   *  the OSC socket so the process can exit (§11: no lingering sockets).
   *  Only /g_freeAll is used: the bundled scsynth (SC 3.14) has no
   *  /g_free command and would log a FAILURE on shutdown. */
  async stop() {
    await this.client.send('/g_freeAll', GROUP_ID).catch(() => undefined)
    await this.client.close()
  }
}

/** Creates an engine and starts it (loads def + group + 16 instances). */
async function createAudioEngine(options) {
  const engine = new AudioEngine(options)
  await engine.start()
  return engine
}

module.exports = { AudioEngine, createAudioEngine, toneFrequency, faderValueToGain }
