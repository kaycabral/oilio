// Feature E2E — brief 0048 (F3 — Formalização fiscal) `[critical]`.
//
// Cenários do DoD exercitados de ponta a ponta na UI:
//   - empty-state: uma Unidade informal mostra o CTA "Formalizar unidade";
//   - fluxo real: CNPJ (com máscara) → consulta → review (razão social /
//     fantasia / regime / CNAE / porte) → confirma → seção fiscal read-only;
//   - gate ATIVA: um CNPJ não-ATIVA é recusado e a Unidade segue informal.
//
// BrasilAPI é stubada via `page.route('**/api/tax-id/**')` — a UI consulta o
// route interno `/api/tax-id/[cnpj]` no browser (interceptável), o mesmo padrão
// usado pro CEP (`**/api/postal-code/**`). CNPJ fixture canônico do brief.

import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { UnitsPage } from '../pages'

// PRD Identidade v2 / F5: the fiscal identity moved Org→Unit. The Formalizar
// flow + fiscal section now live on the UNIDADE detail (`/units/[id]`), not the
// old "Empresa" page (retired → `/company` redirects to `/organizations`). Reach the
// active unit's detail via the units list (⋯ → Editar). `seedOrg` writes
// `Unidade 1`.
async function gotoActiveUnitDetail(authedPage: Parameters<typeof rowAction>[0]) {
  const units = new UnitsPage(authedPage)
  await units.gotoList()
  await rowAction(authedPage, /Unidade 1/, 'Editar')
  await expect(authedPage).toHaveURL(/\/units\/.+/)
}

const CNPJ_DIGITS = '40148980000199'
const CNPJ_MASKED = '40.148.980/0001-99'

const LOOKUP_BODY = {
  profile: {
    taxId: CNPJ_DIGITS,
    isMei: false,
    taxRegime: 'simples_nacional',
    primaryActivity: {
      code: '6201501',
      description: 'Desenvolvimento de programas de computador sob encomenda',
    },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    shareCapital: 1000,
    activityStartedAt: '2020-12-17',
  },
  legalName: 'CABRAL TECNOLOGIA LTDA',
  tradeName: 'CABRAL TECH',
}

test.describe('Formalização fiscal (brief 0048)', () => {
  test('@critical informal → CNPJ ATIVA → review → confirma → seção fiscal read-only', async ({
    authedPage,
  }) => {
    await authedPage.route('**/api/tax-id/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LOOKUP_BODY),
      }),
    )

    await gotoActiveUnitDetail(authedPage)

    // Empty-state: the informal unit surfaces the Formalizar CTA on its detail.
    await expect(authedPage.getByText('Formalizar unidade')).toBeVisible()

    // CNPJ input with mask: typing digits renders the formatted value.
    const cnpjInput = authedPage.getByLabel('CNPJ', { exact: true })
    await cnpjInput.fill(CNPJ_DIGITS)
    await expect(cnpjInput).toHaveValue(CNPJ_MASKED)

    await authedPage.getByRole('button', { name: 'Consultar CNPJ' }).click()

    // Review screen shows the looked-up data BEFORE confirmation.
    await expect(authedPage.getByText('Confira os dados da Receita')).toBeVisible()
    await expect(authedPage.getByText('CABRAL TECNOLOGIA LTDA')).toBeVisible()
    await expect(authedPage.getByText('CABRAL TECH')).toBeVisible()
    await expect(authedPage.getByText('Simples Nacional')).toBeVisible()

    await authedPage.getByRole('button', { name: 'Confirmar e formalizar' }).click()

    // Fiscal section now read-only — formalized badge + the data, no CTA.
    // Scope to `main`: the success toast ("Unidade formalizada") carries the
    // same text, so an unscoped query is a strict-mode violation.
    await expect(authedPage.getByText('Identidade fiscal')).toBeVisible()
    await expect(authedPage.getByRole('main').getByText('Unidade formalizada')).toBeVisible()
    await expect(authedPage.getByText(CNPJ_MASKED)).toBeVisible()
    await expect(authedPage.getByText('CABRAL TECNOLOGIA LTDA')).toBeVisible()
    await expect(authedPage.getByText('Formalizar unidade')).toHaveCount(0)
  })

  test('@critical gate ATIVA: CNPJ não-ATIVA é recusado e a Unidade segue informal', async ({
    authedPage,
  }) => {
    await authedPage.route('**/api/tax-id/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...LOOKUP_BODY,
          profile: { ...LOOKUP_BODY.profile, registrationStatus: 'BAIXADA' },
        }),
      }),
    )

    await gotoActiveUnitDetail(authedPage)
    await authedPage.getByLabel('CNPJ', { exact: true }).fill(CNPJ_DIGITS)
    await authedPage.getByRole('button', { name: 'Consultar CNPJ' }).click()
    await authedPage.getByRole('button', { name: 'Confirmar e formalizar' }).click()

    // Clear error; no formalization happened — the CTA is still reachable.
    await expect(authedPage.getByText(/situação cadastral ATIVA/i)).toBeVisible()
    await expect(authedPage.getByText('Identidade fiscal')).toHaveCount(0)
  })
})
