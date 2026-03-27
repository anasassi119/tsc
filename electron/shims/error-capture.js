;(function () {
  'use strict'

  function send(payload) {
    try {
      window.parent.postMessage({ __tsc_shim__: true, ...payload }, '*')
    } catch (_) {}
  }

  // Capture unhandled errors
  window.addEventListener('error', function (e) {
    send({
      type: 'window-error',
      message: e.message || String(e),
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    })
  })

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function (e) {
    const reason = e.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason)
    send({ type: 'unhandled-rejection', message })
  })

  // Intercept console methods
  ;['log', 'warn', 'error', 'info', 'debug'].forEach(function (method) {
    const original = console[method]
    console[method] = function () {
      const args = Array.prototype.slice.call(arguments)
      const message = args
        .map(function (a) {
          if (typeof a === 'string') return a
          try {
            return JSON.stringify(a)
          } catch (_) {
            return String(a)
          }
        })
        .join(' ')
      send({ type: 'console-log', level: method, message })
      original.apply(console, arguments)
    }
  })
})()
