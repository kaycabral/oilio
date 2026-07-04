// Feature E2E for #1367 (brief 0089): the Free tier's team is "você + 1" — the
// owner plus one member, 2 seats total. `createInvite` enforces it (count =
// active members + pending non-expired invites), so on a Free Negócio the FIRST
// invite mints (owner + 1 pending = 2 seats, the cap), and a SECOND invite is
// barred with the upgrade message. A Pro/Advanced org is never gated (covered by
// the rest of the team suite, which seeds Advanced by default).
//
// Runs against the emulator through the real UI flow (dialog → form → server
// action), mirroring team-hierarchy.spec.ts's real-invite path.

import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import { uniqueWhatsapp } from '../helpers/session'

// Fill + submit the invite dialog through the real flow (masked mobile + role +
// "Gerar e abrir no WhatsApp", which mints the invite server-side).
async function submitInvite(dialog: Locator): Promise<void> {
  const mobile = uniqueWhatsapp().slice(2)
  await dialog.getByLabel(/WhatsApp do convidado/i).fill(mobile)
  await chooseOption(dialog, 'Papel', 'Recepção')
  await dialog.getByRole('button', { name: /Gerar e abrir no WhatsApp/i }).click()
}

test.describe('Equipe — limite "você + 1" no plano Grátis (#1367)', { tag: '@critical' }, () => {
  // No Stripe row → Free (default-advanced seed overridden). memberOperationCount:0
  // so the org starts with ONLY the owner (1 seat) — the default seed adds one
  // member operation (a 2nd active seat), which would fill the "você + 1" cap
  // before the first invite and make even it get barred.
  test.use({ orgInput: { tier: 'free', memberOperationCount: 0 } })

  test('Free: 1º convite passa (você + 1), 2º é barrado com upgrade', async ({ authedPage }) => {
    await authedPage.goto('/team')

    // 1st invite: owner (1) + this pending invite (1) = 2 seats → the cap, allowed.
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

    // 2nd invite: the pending invite already occupies the +1 seat, so this one is
    // refused by the gate — no popup, the upgrade message renders inline.
    await authedPage.reload()
    await authedPage.getByRole('button', { name: 'Convidar' }).click()
    const dialog2 = authedPage.getByRole('dialog')
    await submitInvite(dialog2)

    // The gate's upgrade message renders inline — the canonical proof the 2nd
    // invite was refused (the server action returned {ok:false} before minting).
    await expect(
      dialog2.getByText(
        'O plano Grátis permite você + 1 membro. Faça upgrade para o Pro para adicionar mais.',
      ),
    ).toBeVisible()
  })
})
