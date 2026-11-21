import { roleDescription } from '@/domain'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { expect, test } from '../fixtures'
import { listItem } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import { seedInvite, uniqueWhatsapp } from '../helpers/session'

test.describe('Equipe — hierarquia (#1087 AC-07)', { tag: '@critical' }, () => {
  test.describe('org com membros + convites', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 3 } })

    test('Convidar é ação no topo + filtro Status (Todos/Pendentes)', async ({
      org,
      authedPage,
    }) => {
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

      const convidar = authedPage.getByRole('button', { name: 'Convidar' })
      await expect(convidar).toBeVisible()

      await expect(listItem(authedPage, 'Profissional 1')).toBeVisible()
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()

      await chooseOption(authedPage, 'Status', 'Ativos')
      await expect(listItem(authedPage, 'Profissional 1')).toBeVisible()
      await expect(authedPage.getByText(pendingDisplay)).toHaveCount(0)

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

      const convidarBox = await convidar.boundingBox()
      const memberBox = await firstMember.boundingBox()
      expect(convidarBox).not.toBeNull()
      expect(memberBox).not.toBeNull()
      expect(convidarBox!.y).toBeLessThan(memberBox!.y)
    })

    test('criar convite pelo fluxo real (dialog → form → link)', async ({ authedPage }) => {
      await authedPage.goto('/team')

      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()

      const mobile = uniqueWhatsapp().slice(2)
      await dialog.getByLabel(/WhatsApp do convidado/i).fill(mobile)
      await chooseOption(dialog, 'Papel', 'Recepção')

      const [waPopup] = await Promise.all([
        authedPage.context().waitForEvent('page'),
        dialog.getByRole('button', { name: /Gerar e abrir no WhatsApp/i }).click(),
      ])
      await expect
        .poll(() => waPopup.url(), { timeout: 15000 })
        .toContain(encodeURIComponent('/invites/'))
      expect(waPopup.url()).toContain('token')
      await waPopup.close()

      await expect(dialog.getByLabel('Link do convite')).toHaveValue(/\/invites\/.*token=/)
    })

    test('modal de convite mostra a descrição de permissão do papel selecionado (refino C)', async ({
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()

      await expect(
        dialog.getByRole('note', { name: 'Permissões do papel', exact: true }),
      ).toHaveCount(0)
      await expect(
        dialog.getByText('Escolha o papel para ver o que o convidado poderá fazer.'),
      ).toBeVisible()

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
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('render + empty: abre com Convidar no topo, filtro Status, sem convites', async ({
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Convidar' })).toBeVisible()

      await expect(listItem(authedPage, '(você)')).toBeVisible()

      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText('Nenhum convite pendente.')).toBeVisible()
    })
  })
})
