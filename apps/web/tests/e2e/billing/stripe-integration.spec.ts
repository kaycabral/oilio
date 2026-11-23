import { STRIPE_API_VERSION } from '@/shared/billing/stripe-api-version'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  readStripeBinding,
  releaseStripeCustomer,
  signedWebhook,
  stripeMock,
} from '../helpers/stripe-mock'

function stubStripeHostedPage(page: Page, host: RegExp) {
  return page.route(host, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe</h1>' }),
  )
}

async function fixtureCustomerId(): Promise<string> {
  const sub = await stripeMock().subscriptions.retrieve('sub_e2e_fixture')
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id
}

test.describe('Cobrança — integração Stripe (stripe-mock)', { tag: '@critical' }, () => {
  test.describe('owner com assinatura paga', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('mostra o cartão e as faturas lidos do Stripe', async ({ authedPage }) => {
      await authedPage.goto('/settings/billing')

      await expect(authedPage.getByText('Visa •••• 4242')).toBeVisible()
      await expect(authedPage.getByText('Expira 08/2030')).toBeVisible()
      await expect(authedPage.getByText('Nenhum cartão salvo.')).toHaveCount(0)

      const invoice = authedPage.getByRole('row').filter({ hasText: 'Rascunho' })
      await expect(invoice).toHaveCount(1)
      await expect(invoice).toContainText(/US\$\s10,00/)
      await expect(authedPage.getByText('Nenhuma fatura ainda.')).toHaveCount(0)
    })

    test('"Ajustar plano" redireciona para a sessão do portal criada no Stripe', async ({
      authedPage,
    }) => {
      await stubStripeHostedPage(authedPage, /\.stripe\.me\//)
      await authedPage.goto('/settings/billing')

      await authedPage.getByRole('button', { name: 'Ajustar plano' }).click()
      await expect(authedPage).toHaveURL(/^https:\/\/[^/]+\.stripe\.me\/session\//)
    })

    test('confirmar o cancelamento agenda o fim da assinatura no Stripe', async ({
      authedPage,
    }) => {
      await authedPage.goto('/settings/billing')

      await authedPage.getByRole('button', { name: 'Cancelar plano' }).click()
      const dialog = authedPage.getByRole('alertdialog')
      await dialog.getByRole('button', { name: 'Cancelar plano' }).click()

      await expect(
        authedPage.getByText('Plano cancelado. Você mantém o acesso até o fim do período pago.'),
      ).toBeVisible()
    })
  })

  test.describe('Negócio no plano Grátis', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ orgInput: { tier: 'free' } })

    test('"Assinar o Pro" cria o cliente e redireciona para o Checkout do Stripe', async ({
      authedPage,
      org,
    }) => {
      const customerId = (await stripeMock().customers.search({ query: 'metadata["orgId"]:"x"' }))
        .data[0]?.id
      expect(customerId).toBeTruthy()
      await releaseStripeCustomer(String(customerId))
      await stubStripeHostedPage(authedPage, /^https:\/\/checkout\.stripe\.com\//)

      await authedPage.goto('/settings/billing')
      await authedPage.getByRole('button', { name: 'Assinar o Pro' }).click()

      await expect(authedPage).toHaveURL(/^https:\/\/checkout\.stripe\.com\/pay\/.*cs_test_/)
      expect((await readStripeBinding(org.orgId)).stripeCustomerId).toBe(customerId)
    })

    test('webhook assinado de checkout concluído ativa o Pro com a assinatura do Stripe', async ({
      authedPage,
      org,
      request,
    }) => {
      await releaseStripeCustomer(await fixtureCustomerId())
      const { body, signature } = signedWebhook({
        id: `evt_e2e_${org.orgId}`,
        object: 'event',
        type: 'checkout.session.completed',
        api_version: STRIPE_API_VERSION,
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
        data: {
          object: {
            id: `cs_test_e2e_${org.orgId}`,
            object: 'checkout.session',
            client_reference_id: org.orgId,
            customer: null,
            metadata: {},
            mode: 'subscription',
            subscription: `sub_e2e_${org.orgId}`,
          },
        },
      })

      const res = await request.post('/api/webhooks/stripe', {
        data: body,
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      })
      expect(res.status()).toBe(200)
      expect(await res.json()).toEqual({ received: true })

      expect((await readStripeBinding(org.orgId)).tier).toBe('pro')
      await authedPage.goto('/settings/billing')
      await expect(authedPage.getByText('Plano Pro')).toBeVisible()
      await expect(authedPage.getByText('Cancela no fim do ciclo')).toBeVisible()
    })

    test('webhook com assinatura inválida é recusado sem tocar a cobrança', async ({
      org,
      request,
    }) => {
      const { body } = signedWebhook({ id: `evt_e2e_forged_${org.orgId}`, type: 'ping' })
      const res = await request.post('/api/webhooks/stripe', {
        data: body,
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=forged' },
      })
      expect(res.status()).toBe(400)
      expect((await readStripeBinding(org.orgId)).tier).toBeNull()
    })
  })
})
