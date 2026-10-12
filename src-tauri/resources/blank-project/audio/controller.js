// Silence is a technical placeholder; replace this file with the piece's own audio mapping.
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'

function oscString(value) {
  const bytes = Buffer.from(value + '\0')
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)])
}

function message(address, args) {
  const tags = args
    .map(arg =>
      Buffer.isBuffer(arg) ? 'b' : typeof arg === 'string' ? 's' : 'i'
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
    number.writeInt32BE(arg)
    return number
  })
  return Buffer.concat([oscString(address), oscString(',' + tags), ...values])
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

export async function createAudio(mode) {
  const target = mode === 'none' ? null : process.env.PNDS_OSC_TARGET
  if (mode !== 'none' && !target) throw new Error('PNDS_OSC_TARGET is required')
  // External has no piece protocol yet and sends no messages; None opens no audio socket.
  if (mode !== 'internal')
    return {
      status: mode === 'none' ? 'disabled' : 'ready',
      target,
      close: async () => {
        /* No audio resources exist in preview modes. */
      },
    }
  const bus = Number(process.env.PNDS_AUDIO_OUTPUT_BUS)
  const channels = Number(process.env.PNDS_AUDIO_OUTPUT_CHANNELS)
  if (
    !Number.isInteger(bus) ||
    bus < 1 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 64
  )
    throw new Error(
      'Internal audio requires injected private buses and channel count'
    )
  const match = /^(127\.0\.0\.1):([0-9]+)$/.exec(target)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw new Error('Internal target must be the App loopback scsynth')
  const socket = dgram.createSocket('udp4')
  let waiting = null,
    groupCreated = false,
    syncId = 0,
    closed = false,
    audioError = null
  const fail = error => {
    audioError = error
    waiting?.fail(error)
  }
  socket.on('message', bytes => {
    try {
      const packet = reply(bytes)
      if (packet.address === '/fail')
        fail(new Error(String(packet.args[1] ?? 'scsynth failure')))
      else waiting?.receive(packet)
    } catch {
      /* unrelated or malformed reply */
    }
  })
  socket.on('error', fail)
  const send = (address, args) =>
    new Promise((resolve, reject) =>
      socket.send(message(address, args), error =>
        error ? reject(error) : resolve()
      )
    )
  const exchange = (address, args, accept) =>
    new Promise((resolve, reject) => {
      let settled = false
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        waiting = null
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(
        () => finish(new Error(`scsynth did not acknowledge ${address}`)),
        1500
      )
      waiting = {
        fail: finish,
        receive: packet => {
          if (accept(packet)) finish()
        },
      }
      void send(address, args).catch(finish)
    })
  const sync = async () => {
    if (audioError) throw audioError
    const id = ++syncId
    await exchange(
      '/sync',
      [id],
      packet => packet.address === '/synced' && packet.args[0] === id
    )
  }
  const close = async () => {
    if (closed) return
    closed = true
    audioError = null // Cleanup still sends the owned group's release after a startup error.
    try {
      if (groupCreated) {
        await send('/n_free', [1000])
        await sync()
      }
    } finally {
      socket.close()
    }
  }
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.connect(Number(match[2]), match[1], () => {
        socket.removeListener('error', reject)
        resolve()
      })
    })
    const definition = await readFile(
      new URL('../supercollider/synthdefs/pndsBlank.scsyndef', import.meta.url)
    )
    await exchange(
      '/d_recv',
      [definition],
      packet => packet.address === '/done' && packet.args[0] === '/d_recv'
    )
    await send('/g_new', [1000, 0, 0])
    groupCreated = true
    for (let i = 0; i < channels; i++)
      await send('/s_new', ['pndsBlank', 1001 + i, 1, 1000, 'out', bus + i])
    await sync()
    return { status: 'ready', target, close }
  } catch (error) {
    await close().catch(() => {
      /* Preserve the startup error after attempted cleanup. */
    })
    throw error
  }
}
