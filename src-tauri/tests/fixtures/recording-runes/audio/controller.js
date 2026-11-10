// Runes instrument. The score and touch coordinates are owned by the work.
import dgram from 'node:dgram'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

function oscString(value) {
  const bytes = Buffer.from(value + '\0')
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)])
}

function message(address, args) {
  const tags = args
    .map(arg =>
      Buffer.isBuffer(arg) ? 'b' : typeof arg === 'string' ? 's' : Number.isInteger(arg) ? 'i' : 'f'
    )
    .join('')
  const values = args.map(arg => {
    if (typeof arg === 'string') return oscString(arg)
    if (Buffer.isBuffer(arg)) {
      const size = Buffer.alloc(4)
      size.writeInt32BE(arg.length)
      return Buffer.concat([
        size,
        arg,
        Buffer.alloc((4 - (arg.length % 4)) % 4),
      ])
    }
    const number = Buffer.alloc(4)
    if (Number.isInteger(arg)) number.writeInt32BE(arg)
    else number.writeFloatBE(arg)
    return number
  })
  return Buffer.concat([oscString(address), oscString(',' + tags), ...values])
}

// scsynth SynthDef file: "SCgf", int32 version, int16 definition count, then
// each definition starts with its null-terminated, 4-byte-padded symbol name.
// Read-only and tolerant: an unreadable header simply reports no names.
function embeddedNames(bytes) {
  try {
    if (bytes.toString('latin1', 0, 4) !== 'SCgf') return []
    const count = bytes.readInt16BE(8)
    const names = []
    let offset = 10
    for (let i = 0; i < count && offset < bytes.length; i++) {
      const end = bytes.indexOf(0, offset)
      if (end < 0) break
      const name = bytes.toString('utf8', offset, end)
      if (!/^[\x20-\x7e]+$/.test(name)) return []
      names.push(name)
      offset = Math.ceil((end + 1) / 4) * 4
    }
    return names
  } catch { return [] }
}

function reply(bytes) {
  let offset = 0
  const string = () => {
    const end = bytes.indexOf(0, offset)
    if (end < 0) throw new Error('Invalid OSC string')
    const value = bytes.toString('utf8', offset, end)
    offset = Math.ceil((end + 1) / 4) * 4
    return value
  }
  const address = string(),
    tags = string(),
    args = []
  for (const tag of tags.slice(1)) {
    if (tag === 's') args.push(string())
    else if (tag === 'i') {
      args.push(bytes.readInt32BE(offset))
      offset += 4
    } else if (tag === 'f') {
      args.push(bytes.readFloatBE(offset))
      offset += 4
    } else throw new Error('Unsupported OSC reply')
  }
  return { address, args }
}

// Every timbre is a long-line pad: 0.6 s attack in the SynthDef, and these
// 2.6-3.0 s releases. The release value is sent as SC's forced release time
// (negative gate), so it must stay equal to the matching SynthDef's release.
// A pad is held open for as long as the gesture holds; the release starts only
// when the finger lifts or the element disappears, and then always plays its
// whole length (see `release` below).
export const instruments = Object.freeze({
  Swirl: { name: 'runes-instrument', release: 2.6 },
  BigSwirl: { name: 'runes-bigswirl', release: 3 },
  Circle: { name: 'runes-circle', release: 2.8 },
  Star: { name: 'runes-star', release: 2.7 },
  Bubble: { name: 'runes-bubble', release: 2.6 },
  Flower: { name: 'runes-flower', release: 2.9 },
  Ridge: { name: 'runes-ridge', release: 2.7 },
  Cross: { name: 'runes-cross', release: 2.6 },
})

// One shared, always-on space for the whole instrument: parallel long echo and
// reverb returns, built from supercollider/source/runes-space.scd. The numbers
// are mirrored here only so the tests can check the node the runtime creates;
// the sound itself lives in the compiled artifact.
export const space = Object.freeze({
  name: 'runes-space',
  node: 1090,        // below the voice ids (1000 is the group, voices start at 1100)
  rt60: 14,          // reverb decay time, seconds
  echo: 1.8,         // left echo delay, seconds; right is 2.7
  feedback: 0.8,     // echo repeats, with crossed stereo feedback
})

// Exact equal temperament, rather than the rounded display frequencies.
// One octave above the first sketch: D3-A3-E4-B4. On a phone speaker the old
// D2-A2-E3-B3 roots sat almost entirely below 300 Hz and read as near silence;
// the intervals (fifths) and the colour-to-pitch table are unchanged.
export const pitches = Object.freeze(Object.fromEntries(
  [['#E63946', 50], ['#2A6FBB', 57], ['#D98E04', 64], ['#2A9D6F', 71]]
    .map(([color, midi]) => [color, 440 * 2 ** ((midi - 69) / 12)])
))
// Amplitude ceiling of ONE voice. SynthDefs clamp amp to the same value.
export const maxAmplitude = 0.12
// Simultaneous nodes, including release tails.
export const maxVoices = 12
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
// Six complete Flower lines, ordered by their direction modulo 180 degrees.
// The opposite ends of one diameter share its pentatonic note and octave.
const flowerScale = [0, 2, 4, 7, 9, 12]

// Radius of the farthest drawn point of the element, in score px. The performer
// measures it from the same sampled geometry it draws, so each silhouette
// reaches full amplitude at its own edge: Ridge's thin star no longer stays
// near silence because its arms reach only size/12.
function reachOf(item, touch) {
  const reach = Number(touch.reach)
  return Number.isFinite(reach) && reach > 0 ? reach : item.size
}

export function gesture(item, touch, weight) {
  // performer.distance is screen px. x/y already undo the screen transform
  // (and include the Cross draw transform), so use these score-space values.
  const reach = reachOf(item, touch)
  const distance = clamp(Math.hypot(touch.x, touch.y) / reach, 0, 1)
  const angle = ((touch.angle % 360 + 360) % 360) / 360
  let freq = pitches[item.color.toUpperCase()]
  if (item.pattern === 'Flower') {
    // Every drawing contains six diameters 30 degrees apart, even after its
    // seeded rotation. Tiny rounding errors at an axis must not split a line.
    const line = Math.floor(((angle * 360) % 180 + 1e-7) / 30) % 6
    freq *= 2 ** (flowerScale[line] / 12)
  }
  return {
    freq,
    amp: maxAmplitude * (item.pattern === 'Flower' ? Math.sqrt(distance) : distance) * weight,
    distance,
    angle,
    pan: clamp(touch.x / reach, -1, 1) * 0.7,
    // Existing pointer-derived acceleration, px/s²; no motion sensor API.
    cents: clamp(touch.accel / 20000, 0, 1) * 15,
  }
}

// Kept separate from OSC so score boundaries can be checked deterministically.
export function createInstrument(send, bus, { now = () => performance.now() } = {}) {
  const touches = new Map(), voices = new Map()
  let score = null, sampledAt = 0, nextNode = 1100, closed = false
  const params = values => Object.entries(values).flat()
  const timeAt = time => score
    ? Math.min(score.duration, score.playhead + (score.playing ? Math.max(0, time - sampledAt) : 0))
    : 0
  // SC's negative gate is a forced release time. A pad always rings its full
  // 2.6-3.0 s: nothing shortens the tail, neither the element's visible
  // deadline nor the end of the score. It is also used for the 10 ms fade that
  // recycles an existing release tail when the node ceiling is full.
  function gate(voice, time, seconds) {
    send('/n_set', [voice.node, 'gate', -1 - seconds])
    voice.until = time + seconds * 1000 + 30
  }
  function release(voice, time) {
    if (voice.released) return
    gate(voice, time, voice.release)
    voice.released = true
    voices.delete(voice.key)
    voices.set(`tail:${voice.node}`, voice)
  }
  function tick() {
    if (closed) return
    const time = now(), playhead = timeAt(time)
    for (const [key, voice] of voices) {
      if (voice.released && time >= voice.until) voices.delete(key)
    }
    const wanted = new Map()
    if (score?.hasScore && score.playing && playhead < score.duration && time - sampledAt <= 1200) {
      for (const [socketId, touch] of touches) {
        if (time - touch.receivedAt > 1200) continue
        const items = score.items.filter(item =>
          item.point === touch.number - 1 && item.startTime < playhead &&
          playhead < item.endTime && instruments[item.pattern] &&
          pitches[item.color.toUpperCase()] && item.size > 0
        )
        const total = items.reduce((sum, item) => sum + item.size, 0)
        for (const item of items) {
          const key = JSON.stringify([socketId, item.point, item.startTime, item.seed, item.pattern])
          wanted.set(key, { item, controls: gesture(item, touch, item.size / total) })
        }
      }
    }
    for (const [key, voice] of voices) {
      // Exactly two events release a held pad: the finger lifting (its key
      // leaves `wanted`) and the element leaving its visible interval
      // (`playhead < endTime` stops holding). Nothing fades on its own.
      if (!voice.released && !wanted.has(key)) release(voice, time)
    }
    for (const [key, { item, controls }] of wanted) {
      let voice = voices.get(key)
      if (!voice) {
        if (voices.size >= maxVoices) {
          // Count tails as voices. Recycle a release tail (oldest first) with a
          // 10 ms fade, then let the next 20 ms tick start the new voice
          // without exceeding maxVoices. When all 12 nodes are still held, the
          // press waits for a tail rather than cutting a pad being held.
          const tail = [...voices.values()].find(v => v.released)
          if (tail) gate(tail, time, 0.01)
          continue
        }
        voice = { key, node: nextNode++, item, release: instruments[item.pattern].release, released: false }
        voices.set(key, voice)
        // addAction 0 = addToHead: pads render before the space node at the tail
        // of group 1000, which then hears and replaces this block's sum.
        send('/s_new', [instruments[item.pattern].name, voice.node, 0, 1000, 'out', bus, ...params(controls)])
      } else {
        voice.item = item
        send('/n_set', [voice.node, ...params(controls)])
      }
    }
  }
  return {
    setScore(state) {
      // Seeking backwards is a new performance position, not a frozen note.
      if (score && state.playhead < timeAt(now()) - 500) {
        for (const voice of voices.values()) release(voice, now())
      }
      score = { ...state }
      sampledAt = now()
      tick()
    },
    touch(socketId, value) {
      if (value.active) touches.set(socketId, { ...value, receivedAt: now() })
      else touches.delete(socketId)
      tick()
    },
    release(socketId) { touches.delete(socketId); tick() },
    tick,
    close() { closed = true; touches.clear(); voices.clear() },
  }
}

export async function createAudio(mode) {
  const target = mode === 'none' ? null : process.env.PNDS_OSC_TARGET
  if (mode !== 'none' && !target) throw new Error('PNDS_OSC_TARGET is required')
  const silent = { setScore() {}, touch() {}, release() {} }
  // External deliberately has no work protocol; None opens no OSC socket.
  if (mode !== 'internal') return {
    ...silent, status: mode === 'none' ? 'disabled' : 'ready', target,
    error: null, close: async () => {},
  }
  const bus = Number(process.env.PNDS_AUDIO_OUTPUT_BUS)
  const channels = Number(process.env.PNDS_AUDIO_OUTPUT_CHANNELS)
  if (!Number.isInteger(bus) || bus < 1 || channels !== 2)
    throw new Error('Runes internal audio requires an injected private bus and exactly 2 channels')
  const match = /^(127\.0\.0\.1):([0-9]+)$/.exec(target)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw new Error('Internal target must be the App loopback scsynth')
  const socket = dgram.createSocket('udp4')
  let waiting = null, groupCreated = false, syncId = 0, closed = false,
    audioError = null, timer = null, instrument = null
  const fail = error => {
    if (audioError) return
    audioError = error
    waiting?.fail(error)
    if (instrument) {
      clearInterval(timer)
      instrument.close()
      if (groupCreated) {
        groupCreated = false
        void send('/n_free', [1000]).catch(() => {})
      }
    }
  }
  socket.on('message', bytes => {
    try {
      const packet = reply(bytes)
      if (packet.address === '/fail') fail(new Error(String(packet.args[1] ?? 'scsynth failure')))
      else waiting?.receive(packet)
    } catch { /* Unrelated or malformed reply. */ }
  })
  socket.on('error', fail)
  const send = (address, args) => new Promise((resolve, reject) =>
    socket.send(message(address, args), error => error ? reject(error) : resolve())
  )
  const exchange = (address, args, accept) => new Promise((resolve, reject) => {
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      waiting = null
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => finish(new Error(`scsynth did not acknowledge ${address}`)), 1500)
    waiting = { fail: finish, receive: packet => { if (accept(packet)) finish() } }
    void send(address, args).catch(finish)
  })
  const sync = async () => {
    if (audioError) throw audioError
    const id = ++syncId
    await exchange('/sync', [id], packet => packet.address === '/synced' && packet.args[0] === id)
  }
  const close = async () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    instrument?.close()
    audioError = null
    try {
      if (groupCreated) { await send('/n_free', [1000]); await sync() }
    } finally { socket.close() }
  }
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.connect(Number(match[2]), match[1], () => {
        socket.removeListener('error', reject)
        resolve()
      })
    })
    // The pad timbres live only in the compiled artifacts, so the runtime has
    // to prove which bytes it loaded: the digest below changes after
    // 「编译 SynthDef」. A digest that never changes across a rebuild means the
    // previous (old) timbre is still playing. The artifact timestamps add the
    // one hint a binary cannot give by itself: an artifact older than its .scd
    // is certainly the previous build.
    const source = await stat(new URL('../supercollider/source/runes-instrument.scd', import.meta.url))
      .catch(() => null)
    for (const [pattern, { name }] of Object.entries(instruments)) {
      const definition = await readFile(new URL(`../supercollider/synthdefs/${name}.scsyndef`, import.meta.url))
      if (definition.length < 10 || definition.toString('latin1', 0, 4) !== 'SCgf')
        throw new Error(`${name}.scsyndef is not a compiled SynthDef file`)
      const names = embeddedNames(definition)
      if (names.length && !names.includes(name))
        console.error(`[runes audio] ${name}.scsyndef embeds ${names.join(', ')}; expected ${name}`)
      await exchange('/d_recv', [definition], packet => packet.address === '/done' && packet.args[0] === '/d_recv')
      const digest = createHash('sha256').update(definition).digest('hex')
      console.log(`[runes audio] loaded ${pattern} -> ${name} ${definition.length} B sha256 ${digest}`)
      const artifact = await stat(new URL(`../supercollider/synthdefs/${name}.scsyndef`, import.meta.url))
        .catch(() => null)
      if (source && artifact && artifact.mtimeMs < source.mtimeMs)
        console.warn(`[runes audio] ${name}.scsyndef is older than runes-instrument.scd, so it is probably the previous timbre: run 「编译 SynthDef」 in the creation workspace and restart the App to load the long-line pads.`)
    }
    // The space is its own compiled artifact, so it is loaded and proven the
    // same way. Without it the work would be completely dry, which is a
    // different piece: a missing artifact is an explicit failure, not a silent
    // fallback to dry pads.
    const spaceSource = await stat(new URL('../supercollider/source/runes-space.scd', import.meta.url))
      .catch(() => null)
    const spaceDefinition = await readFile(new URL(`../supercollider/synthdefs/${space.name}.scsyndef`, import.meta.url))
      .catch(() => {
        throw new Error(`${space.name}.scsyndef is missing: run 「编译 SynthDef」 in the creation workspace so the echo and reverb exist, then restart the App`)
      })
    if (spaceDefinition.length < 10 || spaceDefinition.toString('latin1', 0, 4) !== 'SCgf')
      throw new Error(`${space.name}.scsyndef is not a compiled SynthDef file`)
    const spaceNames = embeddedNames(spaceDefinition)
    if (spaceNames.length && !spaceNames.includes(space.name))
      console.error(`[runes audio] ${space.name}.scsyndef embeds ${spaceNames.join(', ')}; expected ${space.name}`)
    await exchange('/d_recv', [spaceDefinition], packet => packet.address === '/done' && packet.args[0] === '/d_recv')
    const spaceDigest = createHash('sha256').update(spaceDefinition).digest('hex')
    console.log(`[runes audio] loaded space -> ${space.name} ${spaceDefinition.length} B sha256 ${spaceDigest}`)
    await send('/g_new', [1000, 0, 0])
    groupCreated = true
    // /s_new addAction is 0 = addToHead, 1 = addToTail (2 addBefore, 3 addAfter,
    // 4 addReplace). Group 1000 executes head -> tail and an audio bus holds one
    // block only, so the space must be the LAST node of the group (1) while the
    // pads join its head (0): the pads write the bus, then this node reads their
    // sum and replaces it with the effected signal. The previous 0/1 pair put the
    // space first, so it only ever read the cleared bus, the wet path stayed
    // silent and just the dry pads were heard.
    await send('/s_new', [space.name, space.node, 1, 1000, 'bus', bus])
    await sync()
    const spaceArtifact = await stat(new URL(`../supercollider/synthdefs/${space.name}.scsyndef`, import.meta.url))
      .catch(() => null)
    if (spaceSource && spaceArtifact && spaceArtifact.mtimeMs < spaceSource.mtimeMs)
      console.warn(`[runes audio] ${space.name}.scsyndef is older than runes-space.scd, so it is probably the previous space: run 「编译 SynthDef」 and restart the App.`)
    console.log(`[runes audio] group 1000 ready; private stereo bus ${bus}; space node ${space.node} (reverb RT60 ${space.rt60} s); max ${maxVoices} voices`)
    instrument = createInstrument((address, args) => {
      if (!closed && !audioError) void send(address, args).catch(fail)
    }, bus)
    timer = setInterval(instrument.tick, 20)
    return {
      get status() { return audioError ? 'error' : 'ready' },
      get error() { return audioError?.message ?? null },
      target, setScore: instrument.setScore, touch: instrument.touch,
      release: instrument.release, close,
    }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}
