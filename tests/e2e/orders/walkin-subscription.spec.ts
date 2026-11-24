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
      await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
        includedItemIds: [serviceId],
      })

      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()

      await chooseOption(authedPage, 'Cliente', /Walk-in Assinante/)
      await authedPage.getByRole('button', { name: 'Vincular' }).click()
      await expect(authedPage.getByRole('heading', { name: 'Walk-in Assinante' })).toBeVisible()

      await addCatalogItemToOrder(authedPage, 'Corte', { attributionName: 'Profissional 1' })
      await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()
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

      await addCatalogItemToOrder(authedPage, 'Corte', { attributionName: 'Profissional 1' })
      await expect(authedPage.getByText(/sem saldo restante/i)).toBeVisible()
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

      await authedPage.getByRole('button', { name: 'remover', exact: true }).click()
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()
    })
  },
)
