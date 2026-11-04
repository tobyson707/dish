// Minimal local API gateway (stand-in for Kong in the Supabase CLI stack).
// Routes /auth/v1, /rest/v1, /storage/v1, /functions/v1 to local containers.
import http from 'node:http'

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

http
  .createServer((req, res) => {
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
  .listen(PORT, () => console.log(`gateway listening on :${PORT}`))
