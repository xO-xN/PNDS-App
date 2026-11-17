/* global __PNDS_CONTEXT__, URL, location, dispatchEvent, CustomEvent, parent, self, addEventListener */
;(() => {
  const context = __PNDS_CONTEXT__
  let preparation = null
  let preparationFailure = null
  const participation = Object.freeze({
    ...context,
    socketOptions: Object.freeze({ path: `${context.basePath}socket.io/` }),
    resource(relative) {
      const url = new URL(relative, location.origin + context.basePath)
      if (
        url.origin !== location.origin ||
        !url.pathname.startsWith(context.basePath)
      )
        throw new Error('Resource must remain in the confirmed performance')
      return url.href
    },
    storageKey(key) {
      return context.storagePrefix + key
    },
    get preparation() {
      return preparation
    },
    get preparationFailure() {
      return preparationFailure
    },
    reportPreparationFailed() {
      if (preparation || preparationFailure) return preparationFailure
      preparationFailure = Object.freeze({
        type: 'pnds:preparation-failed',
        protocolVersion: 1,
        hostId: context.hostId,
        projectId: context.projectId,
        performanceId: context.performanceId,
        resourceScope: 'page',
      })
      dispatchEvent(
        new CustomEvent('pnds:preparation-failed', {
          detail: preparationFailure,
        })
      )
      if (parent !== self)
        parent.postMessage(preparationFailure, location.origin)
      return preparationFailure
    },
    reportPrepared() {
      if (preparationFailure)
        throw new Error('Page preparation has already failed')
      preparation = Object.freeze({
        type: 'pnds:prepared',
        protocolVersion: 1,
        hostId: context.hostId,
        projectId: context.projectId,
        performanceId: context.performanceId,
        resourceScope: 'page',
      })
      dispatchEvent(new CustomEvent('pnds:prepared', { detail: preparation }))
      if (parent !== self) parent.postMessage(preparation, location.origin)
      return preparation
    },
  })
  globalThis.PNDS_PARTICIPATION = participation
  // A missing script or fatal initialization error cannot prepare a new page.
  // Projects explicitly report failures of their own other required resources;
  // optional images and network reconnection do not become generic stop rules.
  addEventListener(
    'error',
    event => {
      if (event.error || event.target?.tagName === 'SCRIPT')
        participation.reportPreparationFailed()
    },
    true
  )
  addEventListener('unhandledrejection', () =>
    participation.reportPreparationFailed()
  )
})()
