/* global io */
// Add performer interactions here. See docs/implementation.md.
const socket = io()
socket.on('connect_error', error =>
  console.error('PNDS connection:', error.message)
)
