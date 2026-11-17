/* global __PNDS_PROJECT_OWNER__, window, navigator, MessageEvent, DOMException, document, setTimeout */
// Replaced by the native creator with exact, JSON-encoded owner metadata.
;(() => {
  const owner = __PNDS_PROJECT_OWNER__
  const send = data =>
    window.webkit.messageHandlers.pndsProject.postMessage(JSON.stringify(data))
  const host = Object.freeze({
    postMessage(data, origin) {
      if (origin !== '*' && origin !== owner.shellOrigin) return
      send(data)
    },
  })
  Object.defineProperty(window, 'parent', { value: host })
  Object.defineProperty(window, 'PNDS_MEDIA_SURFACE', {
    value: Object.freeze({
      role: owner.role,
      captureAllowed: owner.role !== 'projection',
    }),
  })
  Object.defineProperty(window, '__PNDSProjectReceive', {
    value: data => {
      const event = new MessageEvent('message', {
        data,
        origin: owner.shellOrigin,
      })
      Object.defineProperty(event, 'source', { value: host })
      window.dispatchEvent(event)
    },
  })
  const media = navigator.mediaDevices
  if (media?.getUserMedia) {
    const capture = media.getUserMedia.bind(media)
    media.getUserMedia = constraints => {
      const result =
        owner.role === 'projection'
          ? Promise.reject(
              new DOMException(
                'Projection consumes monitor results.',
                'NotAllowedError'
              )
            )
          : capture(constraints)
      return result.then(
        stream => {
          send({ type: 'pnds:media-active' })
          return stream
        },
        error => {
          send({
            type: 'pnds:media-error',
            name: String(error.name || 'Error'),
          })
          throw error
        }
      )
    }
  }
  const interacting = () => {
    const element = document.activeElement
    send({
      type: 'pnds:guest-focus',
      interacting:
        document.hasFocus() &&
        !!element &&
        element !== document.body &&
        element !== document.documentElement,
    })
  }
  document.addEventListener('focusin', interacting, true)
  document.addEventListener('focusout', () => setTimeout(interacting, 0), true)
  window.addEventListener('focus', interacting)
  window.addEventListener('blur', () => setTimeout(interacting, 0))
  document.addEventListener('visibilitychange', interacting)
})()
