// Brief 0081 (#1321) — comanda avulsa vincula cliente e reconhece a assinatura.
//
// O 0079 fez a comanda reconhecer/auto-marcar a assinatura, mas só quando ela tem
// cliente (via agendamento). A venda avulsa de balcão nascia anônima e imutável, e
// o assinante walk-in pagava cheio. Estes specs provam a feature ponta-a-ponta:
//   Cenário 1+2 — vincular assinante à avulsa → serviço coberto auto-marca
//                 `subscription` (herda 0079), total sai zerado.
//   Cenário 3   — assinante sem saldo → item entra `sale` com MOTIVO visível
//                 (AC-06, sem fallback silencioso pra preço cheio).
//   Cenário 4   — desvincular → o item auto-marcado volta a `sale`.

import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption } from '../helpers/select'
import { seedCustomer, seedService, seedSubscription, uniqueWhatsapp } from '../helpers/session'

test.describe(
  'Comanda avulsa vincula cliente + assinatura (brief 0081)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('Cenário 1+2: avulsa → vincula assinante → serviço coberto auto-marca consumo', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
      })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Walk-in Assinante',
        mobile: uniqueWhatsapp(),
      })
      // Assinatura ativa cujo plano cobre o serviço, com saldo (1 de 4).
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        includedItemIds: [serviceId],
      })

      // Abre uma venda avulsa (anônima).
      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()

      // Vincula o assinante pelo seletor da comanda (brief 0081 / #1323).
      await chooseOption(authedPage, 'Cliente', /Walk-in Assinante/)
      await authedPage.getByRole('button', { name: 'Vincular' }).click()
      await expect(authedPage.getByRole('heading', { name: 'Walk-in Assinante' })).toBeVisible()

      // Adiciona o serviço coberto → auto-marca `subscription` (herda 0079 AC-06).
      // O owner autenticado não é profissional; atribui ao profissional operacional
      // seedado (`memberOperationCount: 1` → "Profissional 1"), senão o serviço é
      // rejeitado ("membro sem cadastro de profissional").
      await addCatalogItemToOrder(authedPage, 'Corte', { attributionName: 'Profissional 1' })
      await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()
      // Coberto → total a pagar zera (R$ 0,00), sem cobrar de novo.
      await expect(authedPage.getByText('R$ 0,00').first()).toBeVisible()
    })

    test('Cenário 3: assinante sem saldo → item entra venda com motivo visível (AC-06)', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
      })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Sem Saldo',
        mobile: uniqueWhatsapp(),
      })
      // Plano por contagem JÁ ESGOTADO (consumed == quantity) → sem saldo restante.
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 2 },
        consumed: 2,
        includedItemIds: [serviceId],
      })

      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await chooseOption(authedPage, 'Cliente', /Sem Saldo/)
      await authedPage.getByRole('button', { name: 'Vincular' }).click()
      await expect(authedPage.getByRole('heading', { name: 'Sem Saldo' })).toBeVisible()

      // Adiciona o serviço: NÃO pode consumir (sem saldo) → entra como venda + o
      // motivo específico aparece (toast) em vez de silenciar o preço cheio.
      await addCatalogItemToOrder(authedPage, 'Corte', { attributionName: 'Profissional 1' })
      await expect(authedPage.getByText(/sem saldo restante/i)).toBeVisible()
      // O item permanece cobrável (preço cheio), não zerado.
      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()
    })

    test('Cenário 4: desvincular o cliente devolve o item coberto para venda', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
      })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Vai Sair',
        mobile: uniqueWhatsapp(),
      })
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        includedItemIds: [serviceId],
      })

      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await chooseOption(authedPage, 'Cliente', /Vai Sair/)
      await authedPage.getByRole('button', { name: 'Vincular' }).click()
      await addCatalogItemToOrder(authedPage, 'Corte', { attributionName: 'Profissional 1' })
      await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()
      await expect(authedPage.getByText('R$ 0,00').first()).toBeVisible()

      // Remove o cliente → a cobertura é reavaliada: sem cliente, o item volta a
      // `sale` e o total volta ao preço cheio (Cenário 4).
      // `exact` desambigua do "Remover item" (✕) da linha do item na comanda.
      await authedPage.getByRole('button', { name: 'remover', exact: true }).click()
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()
    })
  },
)
