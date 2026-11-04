// Prints JWT_SECRET, ANON_KEY and SERVICE_ROLE_KEY for the local stack (HS256).
import { createHmac, randomBytes } from 'node:crypto'
const secret = process.argv[2] || randomBytes(32).toString('hex')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = (payload) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64(payload)
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
}
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 60 * 60 * 24 * 365 * 5
console.log(`JWT_SECRET=${secret}`)
console.log(`ANON_KEY=${sign({ role: 'anon', iss: 'supabase-local', iat, exp })}`)
console.log(`SERVICE_ROLE_KEY=${sign({ role: 'service_role', iss: 'supabase-local', iat, exp })}`)
