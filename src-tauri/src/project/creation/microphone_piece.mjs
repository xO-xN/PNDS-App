// Author-saved composition used by the public chat workflow test.
import microphone from '../modules/pnds-device-microphone/microphone.js'
const { microphoneAction } = microphone
export function createMicrophonePiece({ publish }) {
  const readings = new Map()
  const snapshot = () =>
    [...readings].map(([sourceId, sample]) => ({
      sourceId,
      sample,
      brightness: sample.envelope,
      radius: sample.peak * 100,
      trace: sample.waveform,
      spectrum: sample.fft,
    }))
  function apply({ sourceId, kind, payload }) {
    if (kind === 'action') {
      const event = microphoneAction(payload)
      if (!event) throw new Error('Invalid microphone replay event')
      readings.set(sourceId, event.sample)
      publish()
    } else if (kind === 'leave' || kind === 'release') {
      readings.delete(sourceId)
      publish()
    }
  }
  return {
    snapshot,
    prepareAction: microphoneAction,
    apply,
    release() {
      readings.clear()
      publish()
    },
    restore(state, performers) {
      readings.clear()
      for (const member of performers) {
        const prior = state?.find(reading => reading.sourceId === member.id)
        if (prior) {
          const accepted = microphoneAction({
            kind: 'microphone',
            sample: prior.sample,
          })
          if (!accepted) throw new Error('Invalid microphone snapshot')
          readings.set(`replay:${member.id}`, accepted.sample)
        }
      }
      publish()
    },
  }
}
