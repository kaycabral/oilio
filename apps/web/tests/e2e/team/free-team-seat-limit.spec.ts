import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import { uniqueWhatsapp } from '../helpers/session'

async function submitInvite(dialog: Locator): Promise<void> {
  const mobile = uniqueWhatsapp().slice(2)
  await dialog.getByLabel(/WhatsApp do convidado/i).fill(mobile)
  await chooseOption(dialog, 'Papel', 'Recepção')
  await dialog.getByRole('button', { name: /Gerar e abrir no WhatsApp/i }).click()
}

test.describe('Equipe — limite "você + 1" no plano Grátis (#1367)', { tag: '@critical' }, () => {
  test.use({ orgInput: { tier: 'free', memberOperationCount: 0 } })

  test('Free: 1º convite passa (você + 1), 2º é barrado com upgrade', async ({ authedPage }) => {
    await authedPage.goto('/team')

    await authedPage.getByRole('button', { name: 'Convidar' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByText('Convidar membro')).toBeVisible()

    const [waPopup] = await Promise.all([
      authedPage.context().waitForEvent('page'),
      submitInvite(dialog),
    ])
    await expect
      .poll(() => waPopup.url(), { timeout: 15000 })
      .toContain(encodeURIComponent('/invites/'))
    await waPopup.close()
    await expect(dialog.getByLabel('Link do convite')).toHaveValue(/\/invites\/.*token=/)

    await authedPage.reload()
    await authedPage.getByRole('button', { name: 'Convidar' }).click()
    const dialog2 = authedPage.getByRole('dialog')
    await submitInvite(dialog2)

    await expect(
      dialog2.getByText(
        'O plano Grátis permite você + 1 membro. Faça upgrade para o Pro para adicionar mais.',
      ),
    ).toBeVisible()
  })
})
