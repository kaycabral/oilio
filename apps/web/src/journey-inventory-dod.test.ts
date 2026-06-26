import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Feature-level DoD for brief 0035 (#1074) — "Audit de jornada E2E". This is a
// TESTING feature: its DoD is the inventory + matrix + journey specs being
// green, not a browser flow. So the Feature-level contract is asserted HERE,
// making the régua self-validating: it fails if the inventory loses a persona
// group, the post-login landing journey disappears, or any critical journey
// row regresses to an uncovered "gap".
//
// One test() per DoD scenario (brief 0035 § DoD):
//   Cenário 1 — inventário canônico existe
//   Cenário 2 — landing pós-login coberto (o bug)
//   Cenário 3 — gaps preenchidos (nenhuma jornada crítica descoberta)

// vitest cwd is the web package root (apps/oilio/web); the doc lives one
// level up (apps/oilio/docs).
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
    // os três estados de landing nomeados na régua
    expect(doc).toMatch(/sem org.*\/onboarding/)
    expect(doc).toMatch(/\/onboarding\/profile/)
    expect(doc).toMatch(/com org.*\/dashboard/)
  })

  it('Cenário 3 — nenhuma jornada crítica fica como gap (toda linha coberta)', () => {
    // A coluna de cobertura da matriz só pode dizer "coberto"; uma célula de
    // tabela "gap"/"parcial" significa jornada crítica descoberta. (As palavras
    // aparecem em prosa na legenda/seção "Gaps", mas nunca como célula `| x |`.)
    expect(doc).not.toMatch(/\|\s*gap\s*\|/i)
    expect(doc).not.toMatch(/\|\s*parcial\s*\|/i)
    // sanidade: existe ao menos uma linha de jornada coberta
    expect(doc).toMatch(/\|\s*coberto\s*\|/i)
  })
})
