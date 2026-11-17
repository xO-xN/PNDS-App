/* global document, location, fetch, URL, AbortController, setTimeout, clearTimeout, addEventListener */
;(() => {
  const initial = JSON.parse(
    document.querySelector('#pnds-entry-context').textContent
  )
  const strings = initial.strings
  const panel = document.querySelector('[data-pnds-entry]')
  const host = document.querySelector('[data-pnds-host]')
  const project = document.querySelector('[data-pnds-project]')
  const performance = document.querySelector('[data-pnds-performance]')
  const status = document.querySelector('[data-pnds-status]')
  const controls = document.querySelector('[data-pnds-controls]')
  let candidate = null
  let current = null
  let pending = null
  let error = ''
  let available = true
  let sequence = 0
  let published = 0
  const retired = new Set()
  const cleanupFailed = new Set()
  const feedback = (failure, fallback) =>
    [
      strings.unavailable,
      strings.differentHost,
      strings.changed,
      strings.preparationFailed,
      strings.cancelled,
    ].includes(failure?.message)
      ? failure.message
      : fallback
  const same = (a, b) =>
    Boolean(
      a &&
      b &&
      a.hostId === b.hostId &&
      a.projectId === b.projectId &&
      a.performanceId === b.performanceId
    )
  const identity = info =>
    info.performance ? { hostId: info.hostId, ...info.performance } : null
  const validId = value =>
    typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
  function validate(info) {
    if (
      !info ||
      info.protocolVersion !== 1 ||
      !validId(info.hostId) ||
      typeof info.nodeName !== 'string' ||
      !Object.hasOwn(info, 'performance')
    )
      throw new Error(strings.unavailable)
    if (info.hostId !== initial.hostId) throw new Error(strings.differentHost)
    const run = info.performance
    if (
      run !== null &&
      (!run ||
        !validId(run.projectId) ||
        !validId(run.performanceId) ||
        typeof run.projectName !== 'string' ||
        typeof run.performerUrl !== 'string' ||
        typeof run.supportsPerformerUrl !== 'boolean' ||
        (run.browserParticipation !== undefined &&
          run.browserParticipation !== 1))
    )
      throw new Error(strings.unavailable)
    return info
  }
  const instruction = document.querySelector('[data-pnds-instruction]')
  const actionLabel = document.querySelector('[data-pnds-action-label]')
  const keyHint = document.querySelector('[data-pnds-keyhint]')
  const template = document.querySelector('[data-pnds-gesture-template]')
  let formOwner = null
  let cleanupRetry = null
  let revealedKey = ''
  let revealAnimation = null
  const keyOf = run =>
    run ? `${run.hostId}/${run.projectId}/${run.performanceId}` : ''
  const eligible = () =>
    candidate?.browserParticipation === 1 && !same(current?.identity, candidate)
  function showIntent(intent) {
    if (!formOwner || !same(formOwner.identity, candidate)) return
    formOwner.intent = intent
    formOwner.form
      .querySelector('.pnds-slingshot')
      .classList.toggle('is-armed', !pending && intent.armed)
    if (pending) return
    instruction.textContent =
      error === strings.preparationFailed && !intent.dragging && !intent.light
        ? strings.failed
        : intent.armed
          ? current
            ? strings.release
            : strings.releaseFirst
          : current
            ? strings.pull
            : strings.pullFirst
    if (!error && !cleanupFailed.size && available)
      status.textContent = intent.light
        ? strings.shortPull
        : intent.dragging && !intent.armed
          ? strings.pullMore
          : ''
  }
  function renderControls() {
    if (eligible()) {
      const key = keyOf(candidate)
      if (!formOwner || formOwner.key !== key) {
        formOwner?.gesture?.dispose()
        controls.querySelector('form')?.remove()
        const form = document.createElement('form')
        form.method = 'post'
        form.action = `/__pnds/enter/${key}`
        form.dataset.pndsEnterForm = ''
        form.append(template.content.cloneNode(true))
        const displayed = { ...candidate }
        const owner = {
          key,
          identity: displayed,
          form,
          gesture: null,
          intent: { armed: false, dragging: false, light: false },
        }
        formOwner = owner
        const confirm = (withFlight = false) => {
          if (
            formOwner !== owner ||
            pending ||
            !available ||
            !same(displayed, candidate)
          )
            return false
          void enter(displayed, withFlight)
          return Boolean(pending && same(pending.identity, displayed))
        }
        form.addEventListener('submit', event => {
          event.preventDefault()
          confirm()
        })
        controls.prepend(form)
        if (typeof globalThis.createPndsEntryGesture === 'function') {
          owner.gesture = globalThis.createPndsEntryGesture({
            ball: form.querySelector('[data-pnds-ball]'),
            arrow: form.querySelector('[data-pnds-arrow]'),
            band: form.querySelector('[data-pnds-band]'),
            onConfirm: captured => captured === key && confirm(true),
            onIntent: showIntent,
            onLaunchEnd: captured => {
              if (formOwner === owner && captured === key)
                pending?.finishLaunch?.()
            },
          })
        }
      }
      const form = formOwner.form
      form.querySelector('[data-pnds-ball]').disabled =
        Boolean(pending) || !available
      const loading = Boolean(pending)
      form.querySelector('[data-pnds-spinner]').hidden = !loading
      form
        .querySelector('[data-pnds-loader]')
        .setAttribute('aria-hidden', String(!loading))
      formOwner.gesture?.update({
        key: formOwner.key,
        enabled: available && !pending,
        busy: Boolean(pending),
      })
      showIntent(formOwner.intent)
    } else {
      formOwner?.gesture?.dispose()
      formOwner?.form.remove()
      formOwner = null
      // Remove an initial server-rendered form once its identity is no longer actionable.
      controls.querySelector('form')?.remove()
    }
    if (cleanupFailed.size) {
      if (!cleanupRetry) {
        cleanupRetry = document.createElement('button')
        cleanupRetry.type = 'button'
        cleanupRetry.dataset.pndsCleanupRetry = ''
        cleanupRetry.textContent = strings.retry
        cleanupRetry.addEventListener('click', () => {
          for (const frame of retired) retire(frame)
        })
        panel.querySelector('.pnds-content').append(cleanupRetry)
      }
      cleanupRetry.disabled = Boolean(pending)
      cleanupRetry.inert = Boolean(pending)
      cleanupRetry.setAttribute('aria-hidden', String(Boolean(pending)))
    } else {
      cleanupRetry?.remove()
      cleanupRetry = null
    }
  }
  function focusEntry() {
    if (panel.hidden) current?.frame.focus()
    else if (pending) panel.focus({ preventScroll: true })
    else
      (
        formOwner?.form.querySelector('[data-pnds-ball]') ||
        cleanupRetry ||
        panel
      ).focus({ preventScroll: true })
  }
  function finishHiddenMotion() {
    if (!document.hidden) return
    for (const animation of [
      ...(pending?.loaderAnimations || []),
      ...(pending?.handoffAnimations || []),
    ])
      animation.finish()
  }
  function render() {
    const wasHidden = panel.hidden
    const wasBusy = panel.classList.contains('is-busy')
    const actionable = eligible()
    const showAction = Boolean(actionable && available)
    panel.classList.toggle('has-score', Boolean(current))
    panel.classList.toggle('is-ready', showAction || Boolean(pending))
    panel.classList.toggle('is-busy', Boolean(pending))
    panel.classList.toggle('is-launching', pending?.phase === 'launching')
    panel.classList.toggle('is-loading', Boolean(pending))
    panel.classList.toggle('is-handoff', pending?.phase === 'handoff')
    panel.classList.toggle(
      'has-error',
      !pending && error === strings.preparationFailed
    )
    panel.dataset.state = !available
      ? 'unavailable'
      : !candidate
        ? 'waiting'
        : candidate.browserParticipation === 1
          ? 'ready'
          : 'adaptationRequired'
    panel.dataset.projectId = candidate?.projectId || ''
    panel.dataset.performanceId = candidate?.performanceId || ''
    panel.hidden = Boolean(
      current && !pending && !cleanupFailed.size && !showAction
    )
    panel.setAttribute('aria-busy', String(Boolean(pending)))
    panel.setAttribute(
      'role',
      current || pending || showAction ? 'dialog' : 'main'
    )
    if (current || pending || showAction)
      panel.setAttribute('aria-modal', 'true')
    else panel.removeAttribute('aria-modal')
    panel.setAttribute(
      'aria-label',
      pending ? strings.loading : showAction ? strings.ready : strings.title
    )
    if (!pending || !project.textContent)
      project.textContent = candidate?.projectName || ''
    performance.textContent = candidate
      ? `${strings.performance}: ${candidate.performanceId}`
      : ''
    actionLabel.textContent = current ? strings.ready : strings.firstReady
    if (!pending || !instruction.textContent)
      instruction.textContent =
        error === strings.preparationFailed
          ? strings.failed
          : current
            ? strings.pull
            : strings.pullFirst
    if (!pending || !status.textContent) {
      status.textContent =
        (cleanupFailed.size ? strings.cleanupPending : '') ||
        error ||
        (pending
          ? strings.preparing
          : !available
            ? strings.unavailable
            : candidate && candidate.browserParticipation !== 1
              ? strings.adaptationRequired
              : '')
    }
    keyHint.hidden = !showAction
    for (const element of panel.querySelectorAll(
      '[data-pnds-waiting], .pnds-incoming, [data-pnds-instruction], [data-pnds-status], [data-pnds-keyhint], [data-pnds-save]'
    )) {
      element.inert = Boolean(pending)
      element.setAttribute('aria-hidden', String(Boolean(pending)))
    }
    if (current) {
      const blocked = !panel.hidden
      current.frame.inert = blocked
      current.frame.classList.toggle('is-obscured', blocked)
      current.frame.classList.toggle('is-loading', blocked && Boolean(pending))
      if (blocked && (wasHidden || document.activeElement === current.frame))
        current.frame.contentWindow.blur()
    }
    renderControls()
    const displayKey = showAction ? keyOf(candidate) : ''
    if (panel.hidden) {
      revealAnimation?.cancel()
      revealedKey = ''
    } else if (displayKey && (wasHidden || displayKey !== revealedKey)) {
      revealAnimation?.cancel()
      revealAnimation = panel.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 640,
        easing: 'ease-out',
      })
      revealedKey = displayKey
    } else if (!pending) revealedKey = displayKey
    if ((current && wasHidden !== panel.hidden) || (wasBusy && !pending))
      focusEntry()
  }
  // Own the frame until its old browsing context has actually navigated away.
  // A failed navigation remains hidden/inert and available for another cleanup.
  function retire(frame) {
    if (!frame) return
    frame.inert = true
    frame.className = 'pnds-retiring'
    frame.removeAttribute('data-pnds-current')
    frame.removeAttribute('data-pnds-candidate')
    retired.add(frame)
    let finished = false
    const loaded = () => {
      try {
        if (frame.contentWindow.location.href !== 'about:blank') return
        finished = true
        clearTimeout(timer)
        frame.removeEventListener('load', loaded)
        frame.remove()
        retired.delete(frame)
        cleanupFailed.delete(frame)
        render()
      } catch {
        /* Keep ownership until a later cleanup succeeds. */
      }
    }
    const timer = setTimeout(() => {
      frame.removeEventListener('load', loaded)
      if (!finished && retired.has(frame)) {
        cleanupFailed.add(frame)
        render()
      }
    }, 3000)
    frame.addEventListener('load', loaded)
    try {
      frame.contentWindow.location.replace('about:blank')
    } catch {
      cleanupFailed.add(frame)
      render()
    }
  }
  function cancelPending() {
    const operation = pending
    if (!operation) return
    pending = null
    operation.abort.abort()
    operation.reject?.(new Error(strings.cancelled))
    operation.finishVisual?.()
    operation.handoffAnimations?.forEach(animation => animation.cancel())
    clearTimeout(operation.timeout)
    retire(operation.frame)
  }
  function publish(info, request) {
    if (request < published) return
    published = request
    if (!available && !pending) error = ''
    available = true
    host.textContent = info.nodeName
    const next = identity(info)
    if (!(next === null && candidate === null) && !same(next, candidate)) {
      if (pending && !same(pending.identity, next)) {
        cancelPending()
        error = strings.changed
      } else error = ''
    }
    candidate = next
    render()
  }
  async function readMetadata(signal) {
    if (signal?.aborted) throw new Error(strings.cancelled)
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(cancel, 2000)
    try {
      const response = await fetch('/__pnds/participation', {
        cache: 'no-store',
        signal: abort.signal,
      })
      if (!response.ok) throw new Error(strings.unavailable)
      return validate(await response.json())
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
    }
  }
  async function discover() {
    const request = ++sequence
    try {
      publish(await readMetadata(), request)
    } catch (failure) {
      if (request >= published) {
        published = request
        available = false
        if (pending) {
          cancelPending()
          error = feedback(failure, strings.unavailable)
        } else if (!current) error = feedback(failure, strings.unavailable)
        render()
      }
    }
    setTimeout(discover, 1000)
  }
  async function check(operation) {
    const request = ++sequence
    const info = await readMetadata(operation.abort.signal)
    publish(info, request)
    if (
      pending !== operation ||
      !same(operation.identity, identity(info)) ||
      !same(operation.identity, candidate)
    )
      throw new Error(strings.changed)
  }
  async function enter(displayed, withFlight = false) {
    if (
      !displayed ||
      pending ||
      !available ||
      !same(displayed, candidate) ||
      candidate.browserParticipation !== 1
    )
      return
    const operation = {
      identity: { ...displayed },
      abort: new AbortController(),
      frame: null,
      timeout: null,
      reject: null,
      phase: withFlight ? 'launching' : 'loading',
    }
    operation.visualReady = withFlight
      ? new Promise(resolve => {
          operation.finishVisual = resolve
        })
      : Promise.resolve()
    operation.finishLaunch = () => {
      if (pending !== operation || operation.phase !== 'launching') return
      operation.phase = 'loading'
      render()
      const loader = formOwner?.form.querySelector('[data-pnds-loader]')
      // Flush the opacity change so WebKit exposes its actual CSS transition.
      loader?.getBoundingClientRect()
      operation.loaderAnimations = loader?.getAnimations() || []
      finishHiddenMotion()
      Promise.all(
        operation.loaderAnimations.map(animation => animation.finished)
      )
        .catch(() => undefined)
        .then(() => operation.finishVisual())
    }
    pending = operation
    operation.timeout = setTimeout(() => {
      if (pending !== operation) return
      cancelPending()
      error = strings.preparationFailed
      render()
    }, 20000)
    error = ''
    render()
    focusEntry()
    try {
      await check(operation)
      const response = await fetch(
        `/__pnds/enter/${displayed.hostId}/${displayed.projectId}/${displayed.performanceId}`,
        { method: 'POST', signal: operation.abort.signal, cache: 'no-store' }
      )
      const url = new URL(response.url)
      if (!response.ok)
        throw new Error(
          response.status === 409 ? strings.changed : strings.preparationFailed
        )
      if (
        url.origin !== location.origin ||
        !/^\/__pnds\/run\/[a-f0-9]{64}\/$/i.test(url.pathname)
      )
        throw new Error(strings.changed)
      if (pending !== operation || !same(displayed, candidate)) return
      const frame = document.createElement('iframe')
      operation.frame = frame
      frame.title = displayed.projectName
      frame.className = 'pnds-candidate'
      frame.dataset.pndsCandidate = ''
      frame.inert = true
      frame.tabIndex = -1
      frame.allowFullscreen = true
      const prepared = new Promise((resolve, reject) => {
        operation.reject = reject
        operation.prepared = false
        operation.loaded = false
        operation.resolve = () => {
          if (!operation.prepared || !operation.loaded) return
          // WindowProxy survives navigation; verify the currently loaded
          // Document also owns this preparation, not just a queued message.
          const context = frame.contentWindow.PNDS_PARTICIPATION
          const report = context?.preparation
          if (
            !context?.preparationFailure &&
            report?.protocolVersion === 1 &&
            report.resourceScope === 'page' &&
            same(operation.identity, report)
          )
            resolve()
        }
        frame.addEventListener(
          'load',
          () => {
            try {
              const loaded = new URL(frame.contentWindow.location.href)
              if (
                loaded.origin !== url.origin ||
                !loaded.pathname.startsWith(url.pathname)
              ) {
                reject(new Error(strings.preparationFailed))
                return
              }
              operation.loaded = true
              operation.resolve()
            } catch {
              reject(new Error(strings.preparationFailed))
            }
          },
          { once: true }
        )
        frame.addEventListener(
          'error',
          () => reject(new Error(strings.preparationFailed)),
          { once: true }
        )
      })
      frame.src = url.href
      document.body.append(frame)
      await prepared
      await operation.visualReady
      await check(operation)
      if (pending !== operation) return
      operation.phase = 'handoff'
      render()
      revealAnimation?.cancel()
      operation.handoffAnimations = []
      // A background WebKit document can pause finite animations at time zero.
      // There is no rendered crossfade to await until the page is visible.
      if (!document.hidden) {
        frame.classList.add('is-revealing')
        operation.handoffAnimations = [
          frame.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 640,
            easing: 'ease-out',
            fill: 'forwards',
          }),
          panel.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 480,
            easing: 'ease-in-out',
            fill: 'forwards',
          }),
        ]
      }
      await Promise.all(
        operation.handoffAnimations.map(animation => animation.finished)
      )
      await check(operation)
      if (pending !== operation) return
      operation.handoffAnimations.forEach(animation => animation.cancel())
      const previous = current
      if (previous) {
        previous.frame.inert = true
        previous.frame.contentWindow.blur()
      }
      frame.className = 'pnds-current'
      frame.removeAttribute('data-pnds-candidate')
      frame.dataset.pndsCurrent = ''
      frame.inert = false
      frame.removeAttribute('tabindex')
      current = { identity: operation.identity, frame }
      clearTimeout(operation.timeout)
      pending = null
      frame.focus()
      // Preparation proves resources, never participant admission.
      panel.dataset.admission = 'unknown'
      retire(previous?.frame)
      render()
    } catch (failure) {
      if (pending !== operation) return
      cancelPending()
      error = feedback(failure, strings.preparationFailed)
      render()
    }
  }
  addEventListener('message', event => {
    const operation = pending
    const report = event.data
    if (
      !operation?.frame ||
      event.source !== operation.frame.contentWindow ||
      event.origin !== location.origin ||
      report?.protocolVersion !== 1 ||
      !same(operation.identity, report)
    )
      return
    if (report.type === 'pnds:prepared' && report.resourceScope === 'page') {
      operation.prepared = true
      operation.resolve()
    } else if (report.type === 'pnds:preparation-failed')
      operation.reject?.(new Error(strings.preparationFailed))
  })
  document.addEventListener('visibilitychange', finishHiddenMotion)
  panel.addEventListener(
    'touchmove',
    event => {
      if (
        !panel.hidden &&
        panel.classList.contains('is-ready') &&
        event.touches.length === 1 &&
        event.cancelable
      )
        event.preventDefault()
    },
    { passive: false }
  )
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && pending) {
      event.preventDefault()
      cancelPending()
      error = strings.cancelled
      render()
      return
    }
    if (event.key !== 'Tab' || panel.hidden || (!current && !pending)) return
    const focusable = [
      ...panel.querySelectorAll('button:not(:disabled), summary, a[href]'),
    ].filter(
      element =>
        !element.closest('[inert]') &&
        !element.hidden &&
        element.getClientRects().length
    )
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const index = focusable.indexOf(document.activeElement)
    if (event.shiftKey && index <= 0) {
      event.preventDefault()
      focusable.at(-1).focus()
    } else if (
      !event.shiftKey &&
      (index < 0 || index === focusable.length - 1)
    ) {
      event.preventDefault()
      focusable[0].focus()
    }
  })
  publish(validate(initial.info), ++sequence)
  void discover()
})()
