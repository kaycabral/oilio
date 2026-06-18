import { coverageBase } from '@cbrl/testing/vitest'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      'server-only': require.resolve('@cbrl/testing/vitest/server-only-shim'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    // Unit-coverage gate (piso anti-regressão, PINADO). O número é baixo DE
    // PROPÓSITO: a lógica do web é majoritariamente server-side (server
    // actions/components) e sua rede real são os testes de integration + e2e
    // no emulator (exigidos no DoD), não unit. Este gate é só um piso
    // anti-regressão da fatia unit-testável (helpers puros, componentes,
    // reducers de UI).
    coverage: {
      ...coverageBase(),
      thresholds: {
        // PINADO (`autoUpdate: false`) com buffer DELIBERADO de ~0.25pp abaixo do
        // pico medido localmente (Identidade v2 / model-v2): o v8 oscila ~0.04–0.2pp
        // entre runs (local↔CI, jsdom/async) e o CI mede um pouco mais baixo —
        // cravar o floor no pico exato faz o gate falhar no run mais baixo. O
        // buffer absorve o ruído sem mascarar cobertura real. Medido local:
        // 31.75/30.86/33.18/32.92 (stmts/branches/funcs/lines).
        statements: 31.5,
        branches: 30.61,
        functions: 32.93,
        lines: 32.67,
        autoUpdate: false,
      },
    },
  },
})
