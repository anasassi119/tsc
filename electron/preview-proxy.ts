/**
 * Lightweight HTTP reverse proxy for TSC preview panel.
 * Proxies requests to the user's dev server and injects the error-capture
 * shim into HTML responses so the renderer can receive console/error events.
 */

import * as http from 'http'
import * as net from 'net'
import * as url from 'url'
import { readFileSync } from 'fs'
import { join } from 'path'

const shimScript = (() => {
  try {
    // Works both in dev (source path) and packaged (out path)
    const candidates = [
      join(__dirname, 'shims', 'error-capture.js'),
      join(__dirname, '..', 'main', 'shims', 'error-capture.js'),
    ]
    for (const p of candidates) {
      try {
        return readFileSync(p, 'utf-8')
      } catch { /* try next */ }
    }
    return ''
  } catch {
    return ''
  }
})()

const SHIM_TAG = `<script>\n${shimScript}\n</script>`

function injectShim(html: string): string {
  if (!shimScript) return html
  // Inject right after <head> or <html>, else prepend
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${SHIM_TAG}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1${SHIM_TAG}`)
  }
  return SHIM_TAG + html
}

export interface ProxyHandle {
  proxyUrl: string
  stop: () => void
}

export async function startPreviewProxy(targetUrl: string): Promise<ProxyHandle> {
  const parsed = new url.URL(targetUrl)
  const targetHost = parsed.hostname
  const targetPort = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10)

  const server = http.createServer((req, res) => {
    const options: http.RequestOptions = {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
    }

    const proxy = http.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] ?? ''
      const isHtml = contentType.includes('text/html')

      if (!isHtml) {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res)
        return
      }

      // Buffer HTML to inject shim
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        const modified = injectShim(body)
        const modifiedBuf = Buffer.from(modified, 'utf-8')

        const headers = { ...proxyRes.headers }
        // Update content-length after injection
        headers['content-length'] = String(modifiedBuf.byteLength)
        // Relax CSP from upstream server so our shim can run
        delete headers['content-security-policy']
        delete headers['content-security-policy-report-only']

        res.writeHead(proxyRes.statusCode ?? 200, headers)
        res.end(modifiedBuf)
      })
    })

    proxy.on('error', (err) => {
      console.error('[preview-proxy] upstream error:', err.message)
      if (!res.headersSent) {
        res.writeHead(502)
        res.end('Bad Gateway — dev server unreachable')
      }
    })

    req.pipe(proxy)
  })

  // WebSocket upgrade proxying (required for Vite HMR)
  server.on('upgrade', (req, socket, head) => {
    const options: http.RequestOptions = {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
    }

    const proxyReq = http.request(options)
    proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
      if (head.length > 0) proxySocket.write(head)
      if (proxyHead.length > 0) (socket as net.Socket).write(proxyHead)
      proxySocket.pipe(socket as net.Socket)
      ;(socket as net.Socket).pipe(proxySocket)
    })
    proxyReq.on('error', () => socket.destroy())
    proxyReq.end()
  })

  const proxyPort = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('Could not get proxy port'))
      }
    })
    server.on('error', reject)
  })

  const proxyUrl = `http://127.0.0.1:${proxyPort}/`

  return {
    proxyUrl,
    stop: () => {
      server.close()
    },
  }
}
