import { expect, test } from '../fixtures'

// E2E for #987 (brief 0008, Grupo B) — each core CRUD area, when empty, renders
// the shared actionable EmptyState whose primary CTA opens the real creation
// flow (just-in-time onboarding). One empty org, every area swept.
//
// AC-03 [critical] [smoke] — empty area → value-oriented empty state + CTA to
//   the real create flow.
// AC-05 [edge] — the create flow the CTA opens is the real one (covered by each
//   area's own baseline.spec for the create→list→empty round-trip).
//
// The per-area create→list→edit→delete round-trip lives in tests/e2e/<area>/
// baseline.spec.ts; this spec owns the empty-state-with-CTA affordance.

// `/memberOperations` was removed (brief 0037 #1085): people management moved to
// `/team`, which is invite-based (not a CRUD create flow), so it's not part of
// this just-in-time-create sweep.
//
// `/units` is NOT in this sweep: PRD Identidade v2 / brief 0046 + F5 folded the
// unit list into `/organizations` (Negócios & Unidades), where a 0-unit org sees
// the unit empty-state inline — covered by units/baseline.spec.ts. The areas
// below stay genuinely empty under a minimal 1-unit org.
const AREAS = [
  {
    // Brief 0023 (#1005) unified the catalog: the old `/services` route was
    // removed (no redirect shim) and the service empty state + CTA now live on
    // `/catalog?kind=service`.
    path: '/catalog?kind=service',
    cta: 'Cadastrar item',
    newPath: '/catalog/new\\?kind=service',
    title: /nenhum item no catálogo/i,
  },
  // NOTE: `/customers` is NOT in this navigation sweep. Since brief 0077 (#1279)
  // its CTA opens a contextual-invite DIALOG (mirrors Equipe), not a create
  // route — so it can't assert a `newPath` navigation. Its empty-state + dialog
  // CTA is covered by its own test below + customers/baseline.spec.ts.
  { path: '/plans', cta: 'Cadastrar plano', newPath: '/plans/new', title: /nenhum plano/i },
  {
    // Brief 0023 (#1005): the old `/products` route was removed; the product
    // empty state + CTA now live on `/catalog?kind=product`.
    path: '/catalog?kind=product',
    cta: 'Cadastrar item',
    newPath: '/catalog/new\\?kind=product',
    title: /nenhum item no catálogo/i,
  },
] as const

test.describe('Empty-state CTAs — core areas (#987)', () => {
  // 1ª unidade criada (o piso pós-fluxo-guiado da v2) + memberOperationCount=0 mantém
  // catálogo/clientes/planos genuinamente vazios, sem disparar o redirect guiado
  // de 0 unidades — cada empty-state + CTA renderiza.
  test.use({
    orgInput: { unitCount: 1, memberOperationCount: 0 },
  })

  for (const area of AREAS) {
    test(`${area.path}: empty state shows a CTA that opens the real create flow`, async ({
      authedPage,
    }) => {
      await authedPage.goto(area.path)

      // AC-03: value-oriented empty state with a primary CTA.
      await expect(authedPage.getByText(area.title)).toBeVisible()
      const cta = authedPage.getByRole('link', { name: area.cta })
      await expect(cta).toBeVisible()

      // CTA opens the real creation flow.
      await cta.click()
      await expect(authedPage).toHaveURL(new RegExp(`${area.newPath}$`))
    })
  }

  // `/customers` empty state (#1279): the primary CTA opens the contextual-invite
  // dialog in place (no navigation), mirroring Equipe.
  test('/customers: empty state CTA opens the contextual-invite dialog', async ({ authedPage }) => {
    await authedPage.goto('/customers')
    await expect(authedPage.getByText(/nenhum cliente/i)).toBeVisible()
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    await expect(dialog.locator('input[name="whatsapp"]')).toBeVisible()
  })
})
