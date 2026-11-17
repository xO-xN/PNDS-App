/* global io, PNDSPlayers, PNDSInput, document, URLSearchParams, location, addEventListener */
// The generic connector owns identity/reconnection. Add work interactions via PNDS_PLAYER.
const participation = globalThis.PNDS_PARTICIPATION
const status = document.createElement('p')
status.setAttribute('role', 'status')
status.setAttribute('aria-live', 'polite')
document.querySelector('main').append(status)
let player = null,
  input = null,
  messages = null,
  recordingMode = null,
  failed = false
function fail(error) {
  if (failed) return
  failed = true
  status.textContent = `${messages?.error ?? ''}${error.message ?? error}`
  input?.close()
  player?.close()
  participation?.reportPreparationFailed?.()
  console.error('PNDS player:', error)
}
function updateInput() {
  // Identity loss clears owned input. A delayed recording mode only gates new
  // starts; actual released gesture IDs above own cleanup across operations.
  input?.setEnabled(Boolean(player?.joined && player.connected && !failed))
  input?.setStartsAllowed(recordingMode !== 'playback')
}
async function connectPerformer() {
  const response = await fetch('./pnds-player.json')
  if (!response.ok)
    throw new Error('Performer identity configuration is unavailable')
  const config = await response.json()
  messages = config.messages
  status.textContent = messages.waiting
  const testClient = new URLSearchParams(location.search).get('pndsTestClient')
  const key = `blank-player${testClient ? `:${testClient}` : ''}`
  const tokenKey =
    participation?.storageKey(key) ?? `pnds:${config.projectId}:${key}`
  // Accessing the browser's storage getter can itself be refused.
  const storage = globalThis.localStorage
  if (!storage) throw new Error('Browser claim storage is unavailable')
  storage.getItem(tokenKey)
  let storageError = null
  const claims = {
    getItem(key) {
      try {
        return storage.getItem(key)
      } catch (error) {
        storageError = error
        throw error
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value)
      } catch (error) {
        storageError = error
        throw error
      }
    },
  }
  player = PNDSPlayers.connectPlayer({
    io(origin, options) {
      const socket = io(origin, options)
      socket.on('pnds:recording', state => {
        for (const released of state.released ?? [])
          if (released.performerId === player?.identity?.id)
            input?.cancel(released.ids)
        recordingMode = state.mode
        updateInput()
      })
      return socket
    },
    origin: undefined,
    socketOptions: { ...participation?.socketOptions },
    tokenKey,
    storage: claims,
    events: {
      join: 'pnds:join',
      joined: 'pnds:joined',
      rejected: 'pnds:rejected',
      control: 'pnds:control',
      action: 'pnds:action',
    },
  })
  globalThis.PNDS_PLAYER = player
  input = PNDSInput.attachInput({
    surface: document.querySelector('main'),
    send: event => player.sendControls(event),
  })
  globalThis.PNDS_INPUT = input
  player.onChange(state => {
    updateInput()
    if (failed) return
    if (storageError || state.rejectedReason) {
      fail(storageError || new Error(state.rejectedReason))
      return
    }
    // Transport failures are temporary. Keep this page and the connector's
    // automatic recovery alive; a successful joined response clears the error.
    if (state.error) {
      status.textContent = `${messages.error}${state.error}`
      return
    }
    status.textContent = state.joined ? messages.ready : messages.waiting
    if (state.joined) participation?.reportPrepared()
  })
}
addEventListener('pagehide', () => {
  input?.close()
  player?.close()
})
void connectPerformer().catch(fail)
