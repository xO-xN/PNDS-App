/* global io, window, setInterval, Worker, fetch, location */
const context = globalThis.PNDS_PARTICIPATION
window.documentToken = Math.random().toString(36)
window.localTicks = 0
window.scoreState = { ticks: 0, inputs: 0, connections: 0 }
setInterval(() => {
  window.localTicks++
  window.scoreState.ticks++
}, 10)
window.addEventListener('keydown', () => {
  window.scoreState.inputs++
  if (!window.scoreAudio) {
    const audio = new window.AudioContext()
    const oscillator = audio.createOscillator()
    // An owned render graph with no speaker output and no hardware capture.
    oscillator.connect(audio.createMediaStreamDestination())
    oscillator.start()
    window.scoreAudio = audio
    void audio.resume()
  }
})
window.scoreWorker = new Worker(context.resource('worker.js?part=7'))
const workerResult = new Promise((resolve, reject) => {
  window.scoreWorker.onmessage = event => resolve(event.data)
  window.scoreWorker.onerror = reject
})
window.scoreProof = (async () => {
  const asset = await fetch(context.resource('asset.json?part=7')).then(r =>
    r.json()
  )
  const worker = await workerResult
  for (const transport of ['polling', 'websocket']) {
    await new Promise((resolve, reject) => {
      const socket = io(location.origin, {
        ...context.socketOptions,
        transports: [transport],
        reconnection: false,
      })
      socket.on('connect', () => socket.emit('echo', transport))
      socket.on('echo', value => {
        if (value !== transport) reject(new Error('Wrong transport echo'))
        else {
          window.scoreState.connections++
          resolve()
        }
      })
      socket.on('connect_error', reject)
    })
  }
  const gate = await fetch(context.resource('preparation.json'))
  if (!gate.ok) throw new Error('Required preparation resource failed')
  context.reportPrepared()
  return { asset, worker, preparation: context.preparation }
})()
