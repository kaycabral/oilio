// Feature E2E for #1087 (brief 0037 AC-07): `/team` hierarchy. "Convidar" is
// the primary action at the top (a dialog trigger in the page header, not a
// form buried mid-page), and the content is a single flat List with a Status
// filter (Todos/Ativos/Pendentes) — no more Membros/Convites tabs. With members
// present, the invite affordance must NOT sink below the members list.
//
// Runs against the emulator (no mocks). The invite is created through the real
// UI flow (dialog → form → server action) and asserted via the returned link;
// pre-seeded pending invites assert the Pendentes filter.

import { formatBrazilPhone, roleDescription } from '@/domain'
import { expect, test } from '../fixtures'
import { listItem } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import { seedInvite, uniqueWhatsapp } from '../helpers/session'

test.describe('Equipe — hierarquia (#1087 AC-07)', { tag: '@critical' }, () => {
  test.describe('org com membros + convites', () => {
    // Several memberOperations → a non-trivial members list, so the "doesn't sink"
    // assertion is meaningful.
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 3 } })

    test('Convidar é ação no topo + filtro Status (Todos/Pendentes)', async ({
      org,
      authedPage,
    }) => {
      // A pre-seeded pending invite so the Pendentes filter has content. Use the
      // canonical generator so the number is a valid BR mobile (9th digit) and
      // clears the invites_pii mobile_br_format CHECK (brief 0087).
      const pendingWhatsapp = uniqueWhatsapp()
      const pendingDisplay = formatBrazilPhone(pendingWhatsapp)
      await seedInvite({
        orgId: org.orgId,
        mobile: pendingWhatsapp,
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
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()

      // Filter Ativos → members only, the pending invite drops.
      await chooseOption(authedPage, 'Status', 'Ativos')
      await expect(listItem(authedPage, 'Profissional 1')).toBeVisible()
      await expect(authedPage.getByText(pendingDisplay)).toHaveCount(0)

      // Filter Pendentes → the seeded invite is there, members drop.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()
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

      // Fill the rebuilt form (brief 0087 Grupo D): a masked mobile field + the
      // shared InviteLinkActions. Typing a valid BR mobile + a role enables the
      // affordances; "Gerar e abrir no WhatsApp" mints the invite (server round-
      // trip) and opens wa.me. The channel is WhatsApp (brief 0084), the number a
      // strict BR mobile (9th digit — brief 0087).
      // National form (drop the 55 country code) so the masked field receives
      // exactly DDD + 9 + 8 digits — a valid BR mobile (brief 0087).
      const mobile = uniqueWhatsapp().slice(2)
      await dialog.getByLabel(/WhatsApp do convidado/i).fill(mobile)
      await chooseOption(dialog, 'Papel', 'Recepção')

      // Clicking "Gerar e abrir no WhatsApp" opens a tab SYNCHRONOUSLY (about:blank)
      // and navigates it to wa.me once the invite is minted server-side — so the
      // round-trip can't push the open outside the click gesture and trip a popup
      // blocker (InviteLinkActions). Capture the popup, then wait for it to land on
      // the wa.me deep link (it starts blank, then the mint resolves and navigates).
      const [waPopup] = await Promise.all([
        authedPage.context().waitForEvent('page'),
        dialog.getByRole('button', { name: /Gerar e abrir no WhatsApp/i }).click(),
      ])
      // wa.me redirects to api.whatsapp.com/send; assert on the stable payload
      // instead of the host — the deep link must carry the accept link + token.
      // Poll with a longer deadline: the tab opens blank, then navigates after the
      // server round-trip + the wa.me → api.whatsapp.com redirect.
      await expect
        .poll(() => waPopup.url(), { timeout: 15000 })
        .toContain(encodeURIComponent('/invites/'))
      expect(waPopup.url()).toContain('token')
      await waPopup.close()

      // After generating, the link preview field carries the real accept link.
      await expect(dialog.getByLabel('Link do convite')).toHaveValue(/\/invites\/.*token=/)
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
      await expect(desc).toContainText(roleDescription('member_operator'))
    })
  })

  test.describe('baseline — só o owner (#17)', () => {
    // 1 unidade (o piso pós-fluxo-guiado da v2 — um dono com 0 unidades é levado
    // ao first-unit antes de qualquer surface) + 0 profissionais isola o caso
    // "equipe só com o owner".
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

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
