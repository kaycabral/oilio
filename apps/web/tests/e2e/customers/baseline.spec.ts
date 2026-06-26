// Baseline E2E — contrato de cobertura mínima (princípio #17 / lyra
// _shared/min-test-coverage.md). TEMPLATE de referência pro resto das features.
//
// Cobre o feijão-com-arroz que os bugs previsíveis exploram:
// - render + empty state
// - criar pelo fluxo REAL da UI → listar
// - editar → reflete
// - excluir → some e a lista volta a renderizar
// - dado degenerado (cliente avulso: userId vazio / sem tags / sem campo id)
//
// Origem: bug /customers 500 em 2026-05-28 (3 bugs triviais que o seed
// "perfeito" do journey escondia). Roda contra build de produção + emulator.

import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCustomerShadowForUser } from '../helpers/session'

// Semeia um cliente "degenerado": um Customer shadow schema-completo cujo
// `userId` aponta pra um User que NÃO existe (avulso sem user resolvível) —
// reproduz a forma que quebrava render + delete antes do fix em customer-read.ts
// (a identidade não materializa → "(usuário não encontrado)").
async function seedDegenerateCustomer(orgId: string): Promise<string> {
  const missingUserId = `e2e-missing-user-${Math.random().toString(36).slice(2)}`
  return await seedCustomerShadowForUser(orgId, missingUserId)
}

test.describe('Customers — baseline (#17)', () => {
  test('render + empty state', async ({ authedPage }) => {
    // No customers → protagonist empty-state (brief 0034 / #1073): the
    // EmptyState takes over with its single CTA; the header is hidden.
    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Nenhum cliente cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Cadastrar cliente' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeHidden()
  })

  test('criar pelo fluxo real → listar → editar → excluir', async ({ authedPage }) => {
    // WhatsApp único: User é dedupado por whatsapp GLOBALMENTE (cross-org);
    // valor fixo colide com runs anteriores no emulator persistido e reusa um
    // User com nome antigo. Ver memória "PII única por test".
    const whatsapp = `119${Date.now().toString().slice(-8)}`

    // Criar
    await authedPage.goto('/customers/new')
    await authedPage.locator('input[name="name"]').fill('Cliente Baseline')
    await authedPage.locator('input[name="whatsapp"]').fill(whatsapp)
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/customers$/)
    await expect(authedPage.getByText('Cliente Baseline')).toBeVisible({ timeout: 5000 })

    // Editar
    await rowAction(authedPage, /Cliente Baseline/, 'Editar')
    await expect(authedPage).toHaveURL(/\/customers\/.+/)
    await authedPage.locator('input[name="name"]').fill('Cliente Baseline Editado')
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/customers$/)
    await expect(authedPage.getByText('Cliente Baseline Editado')).toBeVisible({ timeout: 5000 })

    // Excluir — shared AlertDialog (brief 0033, AC-05/AC-10): high-impact, so
    // type the name to confirm before the destructive button enables.
    await rowAction(authedPage, /Cliente Baseline Editado/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('Cliente Baseline Editado')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Cliente Baseline Editado/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('dado degenerado (cliente avulso sem user/tags/id) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    await seedDegenerateCustomer(org.orgId)

    // Lista renderiza sem 500 (graceful "(usuário não encontrado)").
    await authedPage.goto('/customers')
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeVisible()
    await expect(authedPage.getByText('(usuário não encontrado)')).toBeVisible()

    // Excluir funciona (id vem do doc real, não do campo vazio). Type-to-confirm
    // uses the resolved display name "(usuário não encontrado)".
    await rowAction(authedPage, /usuário não encontrado/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('(usuário não encontrado)')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /usuário não encontrado/)).toBeHidden({
      timeout: 5000,
    })
  })
})
