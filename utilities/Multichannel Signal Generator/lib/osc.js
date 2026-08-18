// Minimal OSC encoder + UDP client (zero dependencies).
//
// Only the subset the Multichannel Signal Generator project needs: address + typed args,
// padded to 4-byte boundaries, sent as one UDP datagram. Big-endian per the
// OSC 1.0 spec. Known-byte fixtures live in test/osc.test.js.

'use strict'

const dgram = require('node:dgram')

/**
 * Padding for strings, replicated exactly from osc-min's `padding()`:
 * `4 - (len % 4)` NULs — including 4 when len is already a multiple of 4
 * (so "gain" becomes 8 bytes, "out" becomes 4, ",fff" tags become 8).
 * The bundled scsynth (SC 3.14.1) parses these exact layouts; any other
 * alignment makes it fail the message ("SynthDef not found" on /s_new,
 * "/fail" on /g_new, "File '' could not be opened" on /d_load paths).
 */
function padOscString(buffer) {
  const pad = 4 - (buffer.length % 4)
  return Buffer.concat([buffer, Buffer.alloc(pad)])
}

/** Pads `buffer` to the alignment scsynth reads for `address`. */
function padStringFor(address, buffer) {
  return padOscString(buffer)
}

/** Type tags use the same padding as every other string. */
function padTagsFor(address, buffer) {
  return padOscString(buffer)
}

/** Encodes a single OSC argument into a Buffer (type tag is added by the caller). */
function encodeArgument(value, address) {
  if (typeof value === 'number') {
    // The bundled scsynth (SC 3.14.1) reads EVERY numeric argument with
    // its float parser — /s_new (node ID, addAction, target, control
    // values), /g_new, /n_set, /sync etc. all expect float-typed numbers.
    // Integer-typed (",i") arguments make it fail the whole message
    // (verified: int /s_new -> "SynthDef not found" on a valid def; int
    // /g_new -> the group is never created). osc-min and sclang emit
    // floats for the same reason. Floats also carry exact 32-bit values
    // for everything this project sends.
    const buffer = Buffer.alloc(4)
    buffer.writeFloatBE(value)
    return buffer
  }
  if (typeof value === 'string') {
    return padStringFor(address, Buffer.from(value, 'utf8'))
  }
  throw new TypeError(`Unsupported OSC argument type: ${typeof value}`)
}

/**
 * Encodes a complete OSC message:
 *   <address padded> ,<type tags padded> <args...>
 * Supported args: integer → 'i', float → 'f', string → 's'.
 */
function encodeMessage(address, args = []) {
  if (!address.startsWith('/')) {
    throw new TypeError(`OSC address must start with '/': ${address}`)
  }
  const typeTags = args.map(argument => {
    if (typeof argument === 'number') return 'f'
    if (typeof argument === 'string') return 's'
    throw new TypeError(`Unsupported OSC argument type: ${typeof argument}`)
  })

  const parts = [padStringFor(address, Buffer.from(address, 'utf8'))]
  parts.push(padTagsFor(address, Buffer.from(`,${typeTags.join('')}`, 'utf8')))
  for (const argument of args) parts.push(encodeArgument(argument, address))

  return Buffer.concat(parts)
}

/**
 * Minimal UDP OSC client: sends encoded messages to one fixed target and
 * can wait for scsynth's replies (/done, /synced). Replies are matched by
 * address only; the payload is ignored (the messages this project uses
 * carry no information the server needs).
 */
class OscClient {
  constructor({ host, port }) {
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new TypeError(`Invalid OSC target ${host}:${port}`)
    }
    this.host = host
    this.port = port
    this.socket = dgram.createSocket('udp4')
    this.replyHandlers = new Set()
    this.socket.on('message', (message) => {
      const address = decodeAddress(message)
      if (!address) return
      for (const handler of this.replyHandlers) {
        handler(address, message)
      }
    })
    // A closed target (or a vanished scsynth) surfaces as an async socket
    // error; swallow it here — the send callback resolves/rejects normally,
    // and the caller decides what an unreachable host means.
    this.socket.on('error', () => undefined)
  }

  /** Sends a message; resolves once the datagram is handed to the OS. */
  send(address, ...args) {
    return new Promise((resolve, reject) => {
      const packet = encodeMessage(address, args)
      this.socket.send(packet, this.port, this.host, error => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  /**
   * Resolves when a reply with `address` arrives (e.g. "/done"), or
   * rejects after `timeoutMs`. Only one waiter per address is expected —
   * the project's startup sequence is strictly serial.
   */
  waitForReply(address, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const handler = (replyAddress, message) => {
        if (replyAddress !== address) return
        clearTimeout(timer)
        this.replyHandlers.delete(handler)
        resolve({ address: replyAddress, data: message })
      }
      const timer = setTimeout(() => {
        this.replyHandlers.delete(handler)
        reject(new Error(`Timed out waiting for ${address} from the audio engine`))
      }, timeoutMs)
      this.replyHandlers.add(handler)
    })
  }

  close() {
    return new Promise(resolve => {
      try {
        this.socket.close(() => resolve())
      } catch {
        resolve() // already closed
      }
    })
  }
}

/** Extracts the OSC address (up to the first NUL) from a datagram. */
function decodeAddress(buffer) {
  const end = buffer.indexOf(0)
  if (end <= 0) return null
  return buffer.toString('utf8', 0, end)
}

module.exports = { OscClient, encodeMessage, encodeArgument, padStringFor }
