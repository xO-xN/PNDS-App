// Deterministic process fixture at Node's UDP transport boundary.
import { EventEmitter } from 'node:events'
import dgram from 'node:dgram'

const string = value => {
  const bytes = Buffer.from(value + '\0')
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)])
}
const packet = (address, args) =>
  Buffer.concat([
    string(address),
    string(
      ',' + args.map(value => (typeof value === 'string' ? 's' : 'i')).join('')
    ),
    ...args.map(value => {
      if (typeof value === 'string') return string(value)
      const bytes = Buffer.alloc(4)
      bytes.writeInt32BE(value)
      return bytes
    }),
  ])
class Transport extends EventEmitter {
  connect(_port, _host, ready) {
    ready()
  }
  send(bytes, sent) {
    const address = bytes.toString('utf8', 0, bytes.indexOf(0))
    if (address === '/d_recv')
      this.emit('message', packet('/done', ['/d_recv']))
    // Deliberately deliver the failure before the send callback, without an exchange waiter.
    if (address === '/g_new')
      this.emit('message', packet('/fail', ['/g_new', 'group rejected']))
    if (address === '/sync')
      this.emit(
        'message',
        packet('/synced', [bytes.readInt32BE(bytes.length - 4)])
      )
    sent()
  }
  close() {
    this.removeAllListeners()
  }
}
dgram.createSocket = () => new Transport()
