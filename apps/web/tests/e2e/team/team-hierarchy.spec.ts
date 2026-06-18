// Feature E2E for #1087 (brief 0037 AC-07): `/team` hierarchy. "Convidar" is
// the primary action at the top (a dialog trigger in the page header, not a
// form buried mid-page), and the content is a single flat List with a Status
// filter (Todos/Ativos/Pendentes) — no more Membros/Convites tabs. With members
// present, the invite affordance must NOT sink below the members list.
//
// Runs against the emulator (no mocks). The invite is created through the real
// UI flow (dialog → form → server action) and asserted via the returned link;
// pre-seeded pending invites assert the Pendentes filter.

import { roleDescription } from '@/domain'
import { expect, test } from '../fixtures'
import { listItem } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import { seedInvite } from '../helpers/session'

test.describe('Equipe — hierarquia (#1087 AC-07)', { tag: '@critical' }, () => {
  test.describe('org com membros + convites', () => {
    // Several professionals → a non-trivial members list, so the "doesn't sink"
    // assertion is meaningful.
    test.use({ orgInput: { unitCount: 1, professionalCount: 3 } })

    test('Convidar é ação no topo + filtro Status (Todos/Pendentes)', async ({
      org,
      authedPage,
    }) => {
      // A pre-seeded pending invite so the Pendentes filter has content.
      const pendingEmail = `pending-${Date.now()}@e2e.local`
      seedInvite({
        orgId: org.orgId,
        email: pendingEmail,
        role: 'receptionist',
        invitedBy: org.uid,
      })

      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      // Convidar is a top-of-page action (button in the header), not a mid-page
      // form. It's a dialog trigger, present and visible on load.
      const convidar = authedPage.getByRole('button', { name: 'Convidar' })
      await expect(convidar).toBeVisible()

      // Single flat List with a Status filter. At rest (Todos) members and the
      // pending invite show together.
      await expect(listItem(authedPage, 'Profissional 1')).toBeVisible()
      await expect(authedPage.getByText(pendingEmail)).toBeVisible()

      // Filter Ativos → members only, the pending invite drops.
      await chooseOption(authedPage, 'Status', 'Ativos')
      await expect(listItem(authedPage, 'Profissional 1')).toBeVisible()
      await expect(authedPage.getByText(pendingEmail)).toHaveCount(0)

      // Filter Pendentes → the seeded invite is there, members drop.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText(pendingEmail)).toBeVisible()
      await expect(listItem(authedPage, 'Profissional 1')).toHaveCount(0)
    })

    test('o convite não afunda abaixo da lista de membros', async ({ authedPage }) => {
      await authedPage.goto('/team')

      const convidar = authedPage.getByRole('button', { name: 'Convidar' })
      const firstMember = listItem(authedPage, 'Profissional 1')
      await expect(convidar).toBeVisible()
      await expect(firstMember).toBeVisible()

      // "Doesn't sink": the Convidar action sits above the members list (smaller
      // top coordinate), regardless of how many members there are.
      const convidarBox = await convidar.boundingBox()
      const memberBox = await firstMember.boundingBox()
      expect(convidarBox).not.toBeNull()
      expect(memberBox).not.toBeNull()
      expect(convidarBox!.y).toBeLessThan(memberBox!.y)
    })

    test('criar convite pelo fluxo real (dialog → form → link)', async ({ authedPage }) => {
      await authedPage.goto('/team')

      // Open the invite dialog from the top action.
      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()

      // Fill + submit the real form (server action generates the invite link).
      const email = `invitee-${Date.now()}@e2e.local`
      await dialog.getByPlaceholder('email@empresa.com').fill(email)
      await chooseOption(dialog, 'Papel', 'Recepção')
      await dialog.getByRole('button', { name: /Convidar|Convidando/ }).click()

      // The invite link is surfaced in-dialog.
      await expect(dialog.getByText(/\/invites\//)).toBeVisible()
    })

    test('modal de convite mostra a descrição de permissão do papel selecionado (refino C)', async ({
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()

      // Before choosing a role, the dialog prompts to pick one to see privileges.
      await expect(
        dialog.getByRole('note', { name: 'Permissões do papel', exact: true }),
      ).toHaveCount(0)
      await expect(
        dialog.getByText('Escolha o papel para ver o que o convidado poderá fazer.'),
      ).toBeVisible()

      // Selecting a role surfaces its capability description; switching roles
      // updates it (derived from `roleDescription`/`defaultPermissionsForRole`).
      await chooseOption(dialog, 'Papel', 'Recepção')
      const desc = dialog.getByRole('note', { name: 'Permissões do papel', exact: true })
      await expect(desc).toContainText(roleDescription('receptionist'))

      await chooseOption(dialog, 'Papel', 'Gerente')
      await expect(desc).toContainText(roleDescription('manager'))

      await chooseOption(dialog, 'Papel', 'Profissional')
      await expect(desc).toContainText(roleDescription('professional'))
    })
  })

  test.describe('baseline — só o owner (#17)', () => {
    test.use({ orgInput: { unitCount: 0, professionalCount: 0 } })

    test('render + empty: abre com Convidar no topo, filtro Status, sem convites', async ({
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Convidar' })).toBeVisible()

      // The list shows just the owner row.
      await expect(listItem(authedPage, '(você)')).toBeVisible()

      // Narrowing the Status filter to Pendentes yields the empty state.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText('Nenhum convite pendente.')).toBeVisible()
    })
  })
})
