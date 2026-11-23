import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { fillUnitWizardUntilReview } from '../helpers/forms'
import { checkStable } from '../helpers/hydration'
import { listItem } from '../helpers/list'
import { enterUnitsAfterCreate } from '../helpers/session'

function mockCep(page: Page) {
  return page.route('**/api/postal-code/**', (route) => {
    const url = route.request().url()
    if (url.includes('99999999')) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'CEP não encontrado' }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        postalCode: '01310100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Avenida Paulista',
      }),
    })
  })
}

test.describe('Wizard de criação de unidade — DoD (#1438 · 0097)', { tag: '@critical' }, () => {
  test.describe('Cenário 1 — criação completa por agendamento, escolha consciente', () => {
    test.use({ orgInput: { unitCount: 0, tier: 'free' } })

    test('trava sem modo, cresce 4→5 com agendamento e cria com Agenda na sidebar', async ({
      authedPage,
    }) => {
      await mockCep(authedPage)
      const ts = Date.now().toString()
      const name = `Wizard Agendamento ${ts}`

      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Passo 1 de 4')).toBeVisible()

      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill(name)
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill(`119${ts.slice(-8)}`)
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()
      await expect(dialog.getByText('Escolha como a unidade atende pra continuar.')).toBeVisible()

      await dialog.getByRole('radio', { name: /Por agendamento/ }).click()
      await expect(dialog.getByText(/Passo 3 de 5/)).toBeVisible()
      await checkStable(dialog.locator('#bh_monday'))
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await expect(dialog.getByLabel(/granularidade dos horários/i)).toBeVisible()
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await expect(dialog.getByText(/Por agendamento · /)).toBeVisible()
      await dialog.getByRole('button', { name: 'Criar unidade', exact: true }).click()

      await enterUnitsAfterCreate(authedPage)
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(listItem(authedPage, new RegExp(ts))).toBeVisible({ timeout: 5000 })
      await expect(authedPage.getByRole('link', { name: 'Agenda', exact: true })).toBeVisible()
    })
  })

  test.describe('Cenário 2 — org paga cria 2ª unidade: custo transparente com aceite', () => {
    test.use({ orgInput: { unitCount: 1, tier: 'advanced' } })

    test('bloco de custo + CTA travado até o aceite', async ({ authedPage }) => {
      await mockCep(authedPage)
      const ts = Date.now().toString()

      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await fillUnitWizardUntilReview(dialog, {
        name: `Segunda Unidade ${ts}`,
        whatsapp: `119${ts.slice(-8)}`,
      })

      await expect(dialog.getByText('Custo adicional desta unidade')).toBeVisible()
      await expect(dialog.getByText('Cobrado hoje (proporcional)')).toBeVisible()
      await expect(dialog.getByText('Nova mensalidade total')).toBeVisible()
      await expect(dialog.getByText(/o valor exato aparecerá na fatura/)).toHaveCount(0)
      const cta = dialog.getByRole('button', { name: 'Confirmar e criar unidade' })
      await expect(cta).toBeDisabled()

      await checkStable(dialog.getByRole('checkbox', { name: /Entendi e concordo/ }))
      await expect(cta).toBeEnabled()
      await cta.click()

      await enterUnitsAfterCreate(authedPage)
      await expect(listItem(authedPage, new RegExp(ts))).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Cenário 3 — voltar e editar sem perder estado', () => {
    test.use({ orgInput: { unitCount: 0, tier: 'free' } })

    test('troca de modo via Editar remove Agenda (5→4) e preserva os demais passos', async ({
      authedPage,
    }) => {
      await mockCep(authedPage)
      const ts = Date.now().toString()
      const name = `Wizard Editar ${ts}`

      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await fillUnitWizardUntilReview(dialog, {
        name,
        whatsapp: `119${ts.slice(-8)}`,
        mode: 'appointment',
      })

      await expect(dialog.getByText(/Passo 5 de 5/)).toBeVisible()
      await expect(dialog.getByText(/Slots de \d+ min/)).toBeVisible()

      const editButtons = dialog.getByRole('button', { name: 'Editar' })
      await editButtons.nth(2).click()
      await dialog.getByRole('radio', { name: /Ordem de chegada/ }).click()
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await expect(dialog.getByText(/Passo 4 de 4/)).toBeVisible()
      await expect(dialog.getByText(/Slots de \d+ min/)).toHaveCount(0)
      await expect(dialog.getByText(/Ordem de chegada \/ balcão · \d+ dia/)).toBeVisible()
      await expect(dialog.getByText(name)).toBeVisible()
      await expect(dialog.getByText(/Avenida Paulista, 200/)).toBeVisible()
    })
  })

  test.describe('Cenário 4 — org grátis sem cobrança não vê bloco de custo', () => {
    test.use({ orgInput: { unitCount: 0, tier: 'free' } })

    test('sem bloco de custo nem checkbox; CTA é "Criar unidade"', async ({ authedPage }) => {
      await mockCep(authedPage)
      const ts = Date.now().toString()

      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await fillUnitWizardUntilReview(dialog, {
        name: `Gratis ${ts}`,
        whatsapp: `119${ts.slice(-8)}`,
      })

      await expect(dialog.getByText('Custo adicional desta unidade')).toHaveCount(0)
      await expect(dialog.getByRole('checkbox')).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Criar unidade', exact: true })).toBeEnabled()
    })
  })

  test.describe('Cenário 5 — @ indisponível bloqueia o passo Identidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('hint de indisponível + Continuar travado até um @ livre', async ({ authedPage }) => {
      const ts = Date.now().toString()
      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('Colisao')
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill(`119${ts.slice(-8)}`)
      const username = dialog.getByRole('textbox', { name: 'Nome de usuário' })
      await username.click()
      await username.fill('unidade-1')

      await expect(dialog.getByText(/já está em uso por outra unidade/i)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      await username.fill(`livre-${ts.slice(-9)}`)
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeEnabled()
    })
  })

  test.describe('Baseline degenerado — nome curto e CEP inexistente', () => {
    test.use({ orgInput: { unitCount: 0, tier: 'free' } })

    test('nome de 1 caractere trava o passo; CEP inexistente falha com mensagem', async ({
      authedPage,
    }) => {
      await mockCep(authedPage)
      const ts = Date.now().toString()
      await authedPage.goto('/organizations')
      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')

      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('A')
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill(`119${ts.slice(-8)}`)
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()

      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('Ab Valida')
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await dialog.getByRole('button', { name: 'Continuar' }).click()

      await dialog.getByRole('textbox', { name: 'CEP' }).fill('99999-999')
      await expect(dialog.getByText(/CEP não encontrado/)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    })
  })
})
