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

// Invite-flow E2E (#786, channel normalized to WhatsApp in brief 0084). Drives
// the happy path + the guards that would silently let a wrong person in if they
// regressed: tampered token + already-consumed (1-use). The strict email match
// (#827) is GONE — identity binding is first-accept-wins, so a covering test
// proves ANY authenticated Google account can accept a valid-token invite and
// the first one claims it. Exercises the real accept action against the emulator.

// A unique, already-normalized BR mobile so the seeded `invites_pii.whatsapp`
// is stable across the run. The number is only the delivery channel — the
// accept flow never matches on it.
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
      whatsapp: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)

    await expect(page.getByRole('heading', { name: /convite para/i })).toBeVisible()
    // The proposed role shows the human label, never the raw enum key (#1299).
    await expect(page.getByText(/papel proposto/i)).toContainText('Gerente')

    await page.getByRole('button', { name: /aceitar convite/i }).click()

    // The server action redirects to /dashboard on success.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    // Invite is marked accepted; membership exists with the proposed role.
    // acceptedByUid + acceptedAt are populated atomically with status (the
    // first-accept-wins write-once binding).
    const acceptedInvite = await readInvite(owner.orgId, inviteId)
    expect(acceptedInvite?.status).toBe('accepted')
    expect(acceptedInvite?.acceptedByUid).toBe(invitee.uid)
    expect(acceptedInvite?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m).not.toBeNull()
    expect(m!.orgId).toBe(owner.orgId)
    expect(m!.role).toBe('manager')
    expect(m!.status).toBe('active')

    // #852: new memberships populate `rlsUnitScope` + `permissions` on creation.
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
      whatsapp: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=tampered-token-xyz`)
    await expect(page.getByRole('heading', { name: /token inválido/i })).toBeVisible()
    // Invite stays pending — never gets consumed by a wrong token.
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
  })

  test('first-accept-wins: qualquer conta Google com token válido aceita (sem match de email)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Brief 0084: the invite no longer binds to a typed email/phone. A Google
    // account that was NOT pre-named on the invite still accepts it, because the
    // signed token is the only barrier and the first accepter claims it. Under
    // the old #827 rule this would have shown "e-mail diferente" and refused.
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const anyAccount = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      whatsapp: uniqueWhatsapp(),
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
      whatsapp: uniqueWhatsapp(),
      role: 'member_operator',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    // A memberOperation is NOT a manager, so the post-accept redirect targets
    // `/agenda`; with no appointment unit it forwards to `/orders`.
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
      whatsapp: uniqueWhatsapp(),
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
      whatsapp: uniqueWhatsapp(),
      role: 'manager',
      invitedBy: owner.uid,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await expect(page.getByRole('heading', { name: /convite expirado/i })).toBeVisible()
    // Stays pending in the doc — the page render path doesn't mutate.
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
  })
})
