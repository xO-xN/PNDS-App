/* global window, io */
// Add score drawing and monitor interactions here. See docs/implementation.md.
const socket = io()
socket.on('connect_error', error =>
  console.error('PNDS connection:', error.message)
)

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
