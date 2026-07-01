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

// Invite-flow E2E (#786). Drives the happy path + the two guards that
// would silently let a wrong person in if they regressed: tampered token
// and email mismatch. Exercises real Firestore + the server action against
// the emulator, no mocks.

test.describe('Fluxo de convite', { tag: '@critical' }, () => {
  test('usuário convidado por owner aceita convite → vínculo criado → redireciona pra /dashboard', async ({
    context,
    page,
    baseURL,
  }) => {
    // Owner seeds a org; we don't sign in as them — we only need their
    // org ID and uid to create the invite.
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })

    // Invitee is a second auth user with verified email.
    const invitee = await seedAuthUser()

    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: invitee.email,
      role: 'manager',
      invitedBy: owner.uid,
    })

    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)

    await expect(page.getByRole('heading', { name: /convite para/i })).toBeVisible()
    // The proposed role shows the human label, never the raw enum key (#1299).
    // A `manager` invite must read "Gerente" — asserting the label here would
    // have caught the pre-fix render that leaked the key ("manager").
    await expect(page.getByText(/papel proposto/i)).toContainText('Gerente')

    await page.getByRole('button', { name: /aceitar convite/i }).click()

    // The server action redirects to /dashboard on success.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

    // Invite is marked accepted; membership exists with the proposed role.
    // #827: acceptedByUid + acceptedAt are populated atomically with status.
    const acceptedInvite = await readInvite(owner.orgId, inviteId)
    expect(acceptedInvite?.status).toBe('accepted')
    expect(acceptedInvite?.acceptedByUid).toBe(invitee.uid)
    expect(acceptedInvite?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const m = await readMembership(membershipDocId(owner.orgId, invitee.uid))
    expect(m).not.toBeNull()
    expect(m!.orgId).toBe(owner.orgId)
    expect(m!.role).toBe('manager')
    expect(m!.status).toBe('active')

    // #852 schema foundation: new memberships populate `rlsUnitScope` and
    // `permissions` on creation (null when not applicable), so legacy code that
    // calls `resolveMembershipPermissions` returns the stored set, not the role
    // default. This locks the contract that the invite-accept path keeps writing
    // the field — drift here would silently downgrade new memberships to
    // "permissions = null = role-default" and mask refinements we apply to
    // defaults later.
    expect(m!.rlsUnitScope).toBeNull()
    expect(m!.permissions).toEqual(defaultPermissionsForRole('manager'))

    // The invitee already had a User doc from sign-in; the new fields exist
    // with their initial values (null / false). Asserting one is enough — the
    // signal we want is "session route writes the new shape on first login",
    // which would fail typecheck before reaching here, but a smoke assertion
    // catches drift if someone hand-edits the doc and forgets a field.
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
      email: invitee.email,
      role: 'manager',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=tampered-token-xyz`)
    await expect(page.getByRole('heading', { name: /token inválido/i })).toBeVisible()
    // Invite stays pending — never gets consumed by a wrong token.
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
  })

  test('rejeita convite quando email da sessão não bate com o do convite', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const wrongUser = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: 'someone-else@example.com',
      role: 'manager',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, wrongUser.email, wrongUser.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await expect(page.getByRole('heading', { name: /e-?mail diferente/i })).toBeVisible()
    expect(await readInviteStatus(owner.orgId, inviteId)).toBe('pending')
    // The retry affordance is rendered — user can drop the wrong session.
    await expect(page.getByRole('button', { name: /sair e relogar/i })).toBeVisible()
  })

  test('aceita convite quando case + whitespace diferem entre email OAuth e email do convite (#827)', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    // Seed the invite with an upper-cased / padded version of the OAuth email.
    // `inviteEmailsMatch` should normalize both sides and still match.
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: `  ${invitee.email.toUpperCase()}  `,
      role: 'member_operator',
      invitedBy: owner.uid,
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await page.getByRole('button', { name: /aceitar convite/i }).click()
    // A memberOperation is NOT a manager, so the post-accept redirect targets
    // `/agenda` instead of the manager-only Dashboard. This org has no
    // appointment unit (unitCount: 0), so `/agenda` itself forwards to `/orders`
    // (its no-agenda fallback) — the operational home a non-manager lands on
    // here. A manager invite → `/dashboard` is covered by the first test.
    await expect(page).toHaveURL(/\/orders/, { timeout: 10_000 })

    const accepted = await readInvite(owner.orgId, inviteId)
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedByUid).toBe(invitee.uid)
  })

  test('rejeita convite já consumido (#827 uso único)', async ({ context, page, baseURL }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: invitee.email,
      role: 'manager',
      invitedBy: owner.uid,
      status: 'accepted',
    })
    await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

    await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
    await expect(page.getByRole('heading', { name: /convite já utilizado/i })).toBeVisible()
  })

  test('mostra mensagem de expirado quando data de expiração já passou (#827)', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
    const invitee = await seedAuthUser()
    const { inviteId, rawToken } = await seedInvite({
      orgId: owner.orgId,
      email: invitee.email,
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
