import { defineConfig } from 'vitest/config'

// Runs against the local Supabase stack (npm run stack:up). Not part of `npm test`.
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
})
