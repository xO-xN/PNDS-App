;(() => {
  const { marker, policy } = globalThis.__PNDS_CHECK_OPTIONS__
  delete globalThis.__PNDS_CHECK_OPTIONS__
  const { window, document, MutationObserver, setTimeout, console } = globalThis
  const errors = []
  const record = text => {
    if (errors.length < 12) errors.push(String(text).slice(0, 800))
  }
  const protect = () => {
    if (!document.head) return false
    const meta = document.createElement('meta')
    meta.httpEquiv = 'Content-Security-Policy'
    meta.content = policy
    document.head.prepend(meta)
    return true
  }
  if (!protect()) {
    const observer = new MutationObserver(() => {
      if (protect()) observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  }
  window.addEventListener(
    'error',
    event => {
      record(
        event.message
          ? `${event.message} at ${event.filename}:${event.lineno}`
          : `Resource failed: ${event.target?.src || event.target?.href || event.target?.tagName}`
      )
    },
    true
  )
  window.addEventListener('unhandledrejection', event =>
    record(event.reason?.stack || event.reason)
  )
  document.addEventListener('securitypolicyviolation', event =>
    record(`Local-only resource policy blocked: ${event.blockedURI}`)
  )
  const original = console.error.bind(console)
  console.error = (...args) => {
    record(args.map(value => String(value)).join(' '))
    original(...args)
  }
  window.open = () => {
    record('Popup requested during check')
    return null
  }
  window.addEventListener(
    'load',
    () =>
      setTimeout(() => {
        document.title = marker + JSON.stringify({ errors })
      }, 1500),
    { once: true }
  )
})()
