export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message)
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } })
}

/** Wraps a handler with CORS, method check, JSON parsing and safe error responses. */
export function handler(fn: (req: Request, body: unknown) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Method not allowed', code: 'method' }, 405)
    let body: unknown
    try {
      const text = await req.text()
      if (text.length > 64_000) throw new HttpError(413, 'Request too large', 'too_large')
      body = text ? JSON.parse(text) : {}
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status)
      return json({ error: 'Invalid JSON body', code: 'bad_json' }, 400)
    }
    try {
      return await fn(req, body)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status)
      // Log the type and message only — never request bodies or user data.
      console.error(`[${new URL(req.url).pathname}]`, (e as Error)?.name, (e as Error)?.message)
      return json({ error: 'Something went wrong on our side. Please try again.', code: 'internal' }, 500)
    }
  }
}

/** Parse with a zod schema and turn issues into a 400. */
export function parseBody<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown): T {
  const r = schema.safeParse(body)
  if (!r.success) {
    const first = r.error.issues[0]
    throw new HttpError(400, `Invalid request: ${first?.path.join('.') || 'body'} — ${first?.message ?? 'invalid'}`, 'validation')
  }
  return r.data
}
