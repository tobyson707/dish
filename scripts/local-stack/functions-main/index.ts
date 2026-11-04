// Local edge-runtime router (mirrors the Supabase self-hosted "main" service).
// Each request /<function-name>/... is served by a fresh user worker.
Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const name = url.pathname.split('/')[1]
  if (!name || name.startsWith('_') || name === 'main') {
    return new Response(JSON.stringify({ error: 'function not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  const envVars = Object.entries(Deno.env.toObject())
  try {
    // deno-lint-ignore no-explicit-any
    const worker = await (globalThis as any).EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      envVars,
      importMapPath: '/home/deno/functions/deno.json',
    })
    return await worker.fetch(req)
  } catch (e) {
    return new Response(JSON.stringify({ error: `worker error: ${(e as Error).message}` }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
})
