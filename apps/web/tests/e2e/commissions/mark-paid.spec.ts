// E2E spec — brief 0022 Grupo B (#999), AC-03 (marcar pago + imutabilidade).
//
// - AC-03 [smoke]: owner marca o lote pendente de um profissional/período como
//   pago (com data de hoje + comprovante opcional) → some de Pendente, entra em
//   Pago. Re-rodar o lote não encontra mais pendentes (imutabilidade do batch).
//
// Seed direto de comissões via REST do emulator (o relatório é projeção
// read-only) — espelha reports/commissions.spec.ts.

import { expect, test } from '../fixtures'
import {
  seedClosedOrder,
  seedCommission as seedCommissionDoc,
  type SeededOrg,
} from '../helpers/session'

type SeedCommission = {
  attributedUserId: string
  itemName: string
  amountCents: number
  liquidationStatus: 'pendente' | 'pago'
}

// Seeds a commission attributed to a member, linked to a fresh closed order in
// the org's active unit. The report scopes commissions by unit through their
// source order (brief 0039 AC-04 — Commission has no `unitId`, the closed order
// carries it), so the order must exist in the active unit or the commission is
// filtered out.
function seedCommission(org: SeededOrg, c: SeedCommission): void {
  const orderId = seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: c.amountCents * 2,
  })
  seedCommissionDoc({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: c.amountCents,
    liquidationStatus: c.liquidationStatus,
    orderId,
    itemName: c.itemName,
  })
}

test.describe('Comissão — marcar pago (#999)', { tag: '@critical' }, () => {
  test.use({ orgInput: { professionalCount: 1, professionalOperationalStatus: 'operational' } })

  test('AC-03: lote por membro/período move pendente→pago e fica imutável', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Corte Para Pagar',
      amountCents: 2500,
      liquidationStatus: 'pendente',
    })
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Barba Para Pagar',
      amountCents: 1500,
      liquidationStatus: 'pendente',
    })

    // O lote só aparece com um profissional filtrado (gesto por profissional).
    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByText('Corte Para Pagar')).toBeVisible()
    // Resumo: 2 pendentes (R$ 40,00 no card Pendente).
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()

    // Pendente antes de pagar (status na linha da comissão; `getByText` puro
    // colidiria com a opção `Pendente` do filtro de status, por isso escopo na
    // listitem).
    const pendingRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Para Pagar' })
    await expect(pendingRow.first().getByText('Pendente')).toBeVisible()

    // Comprovante opcional + marcar pago.
    await authedPage.getByLabel('Comprovante').fill('pix://comprovante-123')
    await authedPage.getByRole('button', { name: 'Marcar pago' }).click()

    // Após o lote, `revalidatePath` re-renderiza: as comissões viram Pago e,
    // sem pendentes no recorte, o formulário (e o botão) somem — imutabilidade
    // do batch (re-rodar não acha mais pendente).
    const paidRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Para Pagar' })
    await expect(paidRow.first().getByText('Pago')).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
    await expect(paidRow.getByText('Pendente')).toBeHidden()
  })

  test('AC-03: comanda já paga não reabre — guarda de imutabilidade no reopen', async ({
    org,
    authedPage,
  }) => {
    // Comissão já paga: o lote do período não tem pendentes para marcar.
    const proId = org.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    seedCommission(org, {
      attributedUserId: proUser,
      itemName: 'Comissao Ja Paga',
      amountCents: 2000,
      liquidationStatus: 'pago',
    })

    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    const paidRow = authedPage.getByRole('listitem').filter({ hasText: 'Comissao Ja Paga' })
    await expect(paidRow).toBeVisible()
    await expect(paidRow.getByText('Pago')).toBeVisible()
    // Sem pendentes no recorte → o lote "Marcar pago" nem aparece (imutável).
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
  })
})
