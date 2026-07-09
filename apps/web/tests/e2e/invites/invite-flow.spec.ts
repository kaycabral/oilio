import { defaultPermissionsForRole, membershipDocId } from '@/domain'
import { expect, test } from '../fixtures'
import {
  readInvite,
  readInviteStatus,
  readMembership,
  readUser,
  seedAuthUser,
  seedInvite,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

let phoneSeq = 0
function uniqueWhatsapp(): string {
  phoneSeq += 1
  return `5511${String(900000000 + phoneSeq).slice(0, 9)}`
}

test.describe('Fluxo de convite', { tag: '@critical' }, () => {
  test('usuário convidado por owner aceita convite → vínculo criado → redireciona pra /dashboard', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()

    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)

    await expect(page.getByRole('heading', { name: /convite para/i })).toBeVisible()
    await expect(page.getByText(/papel proposto/i)).toContainText('Gerente')

    await page.getByRole('button', { name: /aceitar convite/i }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    const acceptedInvite = await readInvite(owner.orgId, inviteId)
    expect(acceptedInvite?.status).toBe('accepted')
    expect(acceptedInvite?.acceptedByUid).toBe(invitee.uid)
    expect(acceptedInvite?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m).not.toBeNull()
    expect(m!.orgId).toBe(owner.orgId)
    expect(m!.role).toBe('manager')
    expect(m!.status).toBe('active')

    expect(m!.rlsUnitScope).toBeNull()
    expect(m!.permissions).toEqual(defaultPermissionsForRole('manager'))

    const u = await readUser(invitee.uid)
    expect(u).not.toBeNull()
    expect(u).toHaveProperty('completionCompleted')
  })

  test('rejeita convite quando token não bate com hash armazenado', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=tampered-token-xyz`)
    await expect(page.getByRole('heading', { name: /token inválido/i })).toBeVisible()
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
  })

  test('first-accept-wins: qualquer conta Google com token válido aceita (sem match de email)', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const anyAccount = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(
      context,
      anyAccount.email,
      anyAccount.password,
      baseURL ?? undefined,
    )

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    const accepted = await readInvite(owner.orgId, inviteId)
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedByUid).toBe(anyAccount.uid)
    const m = await readMembership(membershipDocId(owner.orgId, anyAccount.uid))
    expect(m?.role).toBe('manager')
  })

  test('member_operator aceita → redireciona pra home operacional', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'member_operator',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    await expect(page).toHaveURL(/\/orders/, { timeout: 10_000 })

    const accepted = await readInvite(owner.orgId, inviteId)
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedByUid).toBe(invitee.uid)
  })

  test('rejeita convite já consumido (uso único)', async ({ context, page, baseURL }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
      status: 'accepted',
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await expect(page.getByRole('heading', { name: /convite já utilizado/i })).toBeVisible()
  })

  test('mostra mensagem de expirado quando data de expiração já passou', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      mobile: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await expect(page.getByRole('heading', { name: /convite expirado/i })).toBeVisible()
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
  })
})
