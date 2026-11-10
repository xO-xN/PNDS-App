/* global window, io, location, addEventListener, PNDSMonitorState */
// Add score drawing and monitor interactions here. See docs/implementation.md.
const socket = io()
socket.on('connect_error', error =>
  console.error('PNDS connection:', error.message)
)

const viewListeners = new Set()
let view = null,
  viewReady = false,
  viewClosed = false,
  viewError = null
const copyView = state =>
  state === null ? null : JSON.parse(JSON.stringify(state))
window.PNDSMonitorView = {
  get ready() {
    return viewReady
  },
  get viewState() {
    return view?.viewState ?? null
  },
  get error() {
    return viewError ?? view?.error ?? null
  },
  onViewState(listener) {
    viewListeners.add(listener)
    listener(view?.viewState ?? null)
    return () => viewListeners.delete(listener)
  },
  setViewState(key, value) {
    return view?.setViewState(key, value) ?? false
  },
  reconnect() {
    return !viewClosed && (view?.reconnect() ?? false)
  },
}
async function startMonitorView() {
  const response = await fetch('/__pnds/monitor-view.json')
  if (!response.ok)
    throw new Error(`Monitor view configuration: HTTP ${response.status}`)
  const declarations = await response.json()
  if (viewClosed) return
  viewReady = true
  if (!Object.keys(declarations).length) return
  view = PNDSMonitorState.connectMonitorState({
    io,
    origin: location.origin,
    namespace: '/monitor-view',
    events: {
      monitorSnapshot: 'view:snapshot',
      monitorSet: 'view:set',
      monitorState: 'view:state',
      monitorError: 'view:error',
    },
  })
  view.onViewState(state => {
    for (const listener of viewListeners) listener(copyView(state))
  })
}
void startMonitorView().catch(error => {
  if (viewClosed) return
  viewError = error.message
  console.error('PNDS monitor view:', error.message)
})
addEventListener('pagehide', () => {
  viewClosed = true
  view?.close()
  viewListeners.clear()
})

// Register callbacks for real mutable values; mirror their specs in pnds.preview.json.
const previewParameters = {}

async function startParameterPreview() {
  const context = window.PNDS_PREVIEW_CONTEXT
  if (!context?.hostOrigin || !Object.keys(previewParameters).length) return
  const { installPreviewAdapter } = await import('/pnds-preview.mjs')
  installPreviewAdapter({ ...context, parameters: previewParameters })
}

void startParameterPreview().catch(error =>
  console.error('PNDS parameter preview:', error)
)
