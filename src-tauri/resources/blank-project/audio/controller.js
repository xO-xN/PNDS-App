// Silence is a technical placeholder; replace this file with the piece's own audio mapping.
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'

import { pathToFileURL } from 'node:url'

const shared = process.env.PNDS_SHARED_LIBRARIES
  ? JSON.parse(process.env.PNDS_SHARED_LIBRARIES)['osc-min']
  : null
if (
  process.env.PNDS_SHARED_LIBRARIES &&
  (!shared?.path || shared.version !== '2.1.2')
)
  throw new Error('Missing exact shared osc-min 2.1.2 entry')
const osc = await import(shared ? pathToFileURL(shared.path).href : 'osc-min')
function message(address, args) {
  const view = osc.toBuffer({
    address,
    args: args.map(value => ({
      type: Buffer.isBuffer(value)
        ? 'blob'
        : typeof value === 'string'
          ? 'string'
          : 'integer',
      value,
    })),
  })
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength)
}
function reply(bytes) {
  const packet = osc.fromBuffer(bytes)
  if (packet.oscType !== 'message') throw new Error('Expected an OSC message')
  return { address: packet.address, args: packet.args.map(arg => arg.value) }
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
