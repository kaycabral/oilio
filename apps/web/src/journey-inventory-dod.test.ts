import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DOC_PATH = resolve(process.cwd(), '../docs/e2e-conventions.md')
const doc = readFileSync(DOC_PATH, 'utf8')

describe('Audit de jornada E2E — Feature DoD (brief 0035 · #1074)', () => {
  it('Cenário 1 — o inventário canônico de jornadas por persona existe', () => {
    expect(doc).toContain('## Inventário canônico de jornadas + matriz de cobertura')
    for (const persona of [
      '### Owner / admin',
      '### Recepção / manager',
      '### Profissional',
      '### Cliente (self-booking público)',
      '### Operação (cross-persona)',
    ]) {
      expect(doc, `inventário sem a persona "${persona}"`).toContain(persona)
    }
  })

  it('Cenário 2 — a cadeia de landing pós-login está coberta (o bug que escapou)', () => {
    expect(
      existsSync(resolve(process.cwd(), 'tests/e2e/journeys/owner-login-landing.spec.ts')),
      'spec de landing pós-login ausente',
    ).toBe(true)
    expect(doc).toContain('owner-login-landing.spec.ts')
    expect(doc).toMatch(/sem org.*\/onboarding/)
    expect(doc).toMatch(/\/onboarding\/profile/)
    expect(doc).toMatch(/com org.*\/dashboard/)
  })

  it('Cenário 3 — nenhuma jornada crítica fica como gap (toda linha coberta)', () => {
    expect(doc).not.toMatch(/\|\s*gap\s*\|/i)
    expect(doc).not.toMatch(/\|\s*parcial\s*\|/i)
    expect(doc).toMatch(/\|\s*coberto\s*\|/i)
  })
})
