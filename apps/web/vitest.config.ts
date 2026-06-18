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
    // Unit-coverage ratchet (autoUpdate = one-way, só sobe). O número é baixo
    // DE PROPÓSITO: a lógica do web é majoritariamente server-side (server
    // actions/components) e sua rede real são os testes de integration + e2e
    // no emulator (exigidos no DoD), não unit. Este gate é só um piso
    // anti-regressão da fatia unit-testável (helpers puros, componentes,
    // reducers de UI) — trava o nível atual e sobe conforme unit tests entram.
    coverage: {
      ...coverageBase(),
      thresholds: {
        // Floor sobe com o Copiloto per-unit (#1115): read-models de tracking
        // (puros, unit-cobertos) entram no pool. Segue só-sobe daqui.
        // Buffer DELIBERADO de ~0.2pp abaixo do pico medido: o v8 oscila ~0.05pp
        // entre runs (local↔CI, jsdom/async). Cravar o floor no pico exato faz o
        // gate falhar no run mais baixo — o buffer absorve o ruído e ainda
        // ratcheta acima da main (29.76/28.62/30.63/30.66). Medido local com
        // filter-by-search + nav-items cobertos: 30.15/28.90/31.05/31.14.
        statements: 31,
        branches: 29.99,
        functions: 32,
        lines: 32.07,
        autoUpdate: true,
      },
    },
  },
})
