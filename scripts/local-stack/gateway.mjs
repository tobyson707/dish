// Minimal local API gateway (stand-in for Kong in the Supabase CLI stack).
// Routes /auth/v1, /rest/v1, /storage/v1, /functions/v1 to local containers, and
// /realtime/v1 WebSocket upgrades to Supabase Realtime (tenant "realtime-dev").
import http from 'node:http'
import net from 'node:net'

const ROUTES = [
  ['/auth/v1', 'http://127.0.0.1:9999'],
  ['/rest/v1', 'http://127.0.0.1:3001'],
  ['/storage/v1', 'http://127.0.0.1:5000'],
  ['/functions/v1', 'http://127.0.0.1:9000'],
]
const PORT = Number(process.env.GATEWAY_PORT ?? 54321)
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-upsert, x-supabase-api-version, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      // reflect requested headers (supabase-js adds e.g. x-retry-count on retries)
      const asked = req.headers['access-control-request-headers']
      res.writeHead(204, { ...CORS, ...(asked ? { 'access-control-allow-headers': asked } : {}), 'access-control-max-age': '600' })
      return res.end()
    }
    const hit = ROUTES.find(([p]) => req.url.startsWith(p + '/') || req.url === p || req.url.startsWith(p + '?'))
    if (!hit) {
      res.writeHead(404, { 'content-type': 'application/json', ...CORS })
      return res.end('{"error":"no route"}')
    }
    const [prefix, target] = hit
    const url = new URL(req.url.slice(prefix.length) || '/', target)
    const headers = { ...req.headers, host: url.host }
    // Storage expects the apikey as bearer when no user token is present.
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`
    const upstream = http.request(url, { method: req.method, headers }, (up) => {
      const h = { ...up.headers, ...CORS }
      res.writeHead(up.statusCode ?? 502, h)
      up.pipe(res)
    })
    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json', ...CORS })
      res.end(JSON.stringify({ error: `gateway: ${e.message}` }))
    })
    req.pipe(upstream)
  })

// Realtime: /realtime/v1/websocket?... → :4000/socket/websocket?... The tenant is taken from
// the Host header's first label, as with Kong in the official stack.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/realtime/v1/')) return socket.destroy()
  const path = '/socket/' + req.url.slice('/realtime/v1/'.length)
  const up = net.connect(4000, '127.0.0.1', () => {
    const lines = [`${req.method} ${path} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]
      lines.push(`${k}: ${k.toLowerCase() === 'host' ? 'realtime-dev.localhost:4000' : req.rawHeaders[i + 1]}`)
    }
    up.write(lines.join('\r\n') + '\r\n\r\n')
    if (head?.length) up.write(head)
    socket.pipe(up).pipe(socket)
  })
  const close = () => {
    socket.destroy()
    up.destroy()
  }
  up.on('error', close)
  socket.on('error', close)
})

server.listen(PORT, () => console.log(`gateway listening on :${PORT}`))
