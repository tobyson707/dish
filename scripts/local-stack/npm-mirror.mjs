// Optional local npm registry mirror for sandboxes whose TLS-intercepting proxy
// Deno/edge-runtime can't trust. Node (which honours NODE_EXTRA_CA_CERTS)
// fetches from the real registry; Deno talks plain HTTP to this mirror.
import http from 'node:http'

const UP = 'https://registry.npmjs.org'
const PORT = Number(process.env.NPM_MIRROR_PORT ?? 4873)
const SELF = `http://127.0.0.1:${PORT}`

http
  .createServer(async (req, res) => {
    try {
      const r = await fetch(UP + req.url, { headers: { accept: req.headers.accept ?? '*/*' } })
      const type = r.headers.get('content-type') ?? ''
      if (type.includes('json')) {
        const text = (await r.text()).replaceAll(UP, SELF)
        res.writeHead(r.status, { 'content-type': type })
        return res.end(text)
      }
      res.writeHead(r.status, { 'content-type': type || 'application/octet-stream' })
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      res.writeHead(502)
      res.end(String(e))
    }
  })
  .listen(PORT, () => console.log(`npm mirror on :${PORT}`))
