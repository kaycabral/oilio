import { anonymizedLabel, buildUserAnonymizationScrub, membershipDocId } from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CommissionConfig,
  InviteConfig,
  MemberOperationConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  pgProjectionExists,
  pgReadProjection,
  readMemberOperationByUserId,
  readUser,
  seedAppointment,
  seedBlock,
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedCustomerShadowForUser,
  seedInvite,
  seedOpenOrder,
  seedOrgLink,
  type SeededOrg,
} from '../helpers/session'
import { MemberOperationsPage, PublicBookingPage, orgSlug } from '../pages'

async function memberOperationPiiExists(
  orgId: string,
  memberOperationId: string,
): Promise<boolean> {
  return pgProjectionExists(
    'member_operations_pii',
    aggregateRef(MemberOperationConfig, orgId, memberOperationId),
  )
}

async function inviteStillExists(orgId: string, inviteId: string): Promise<boolean> {
  return pgProjectionExists('invites', aggregateRef(InviteConfig, orgId, inviteId))
}

async function readMembershipStatus(orgId: string, membershipId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  const status = row?.status
  return typeof status === 'string' ? status : null
}

async function readAppointmentStatus(orgId: string, appointmentId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'appointments',
    aggregateRef(AppointmentConfig, orgId, appointmentId),
  )
  const status = row?.status
  return typeof status === 'string' ? status : null
}

async function appointmentExists(orgId: string, appointmentId: string): Promise<boolean> {
  return pgProjectionExists('appointments', aggregateRef(AppointmentConfig, orgId, appointmentId))
}

async function readCommissionLiquidationStatus(
  orgId: string,
  commissionId: string,
): Promise<string | null> {
  const row = await pgReadProjection(
    'commissions',
    aggregateRef(CommissionConfig, orgId, commissionId),
  )
  const status = row?.liquidation_status
  return typeof status === 'string' ? status : null
}

async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  return pgProjectionExists('agenda_blocks', aggregateRef(AgendaBlockConfig, orgId, blockId))
}

async function anonymizeUser(uid: string): Promise<void> {
  const now = new Date().toISOString()
  const scrub = buildUserAnonymizationScrub(now)
  const patched = await patchUser(
    uid,
    {
      display_name: scrub.displayName,
      mobile: scrub.mobile,
      email: scrub.email,
      birth_date: scrub.birthDate,
      tax_identity: scrub.taxIdentity,
      bio: scrub.bio,
      specialties: scrub.specialties,
      avatar_url: scrub.avatarUrl,
      anonymized_at: scrub.anonymizedAt,
    },
    now,
  )
  if (!patched) throw new Error(`anonymizeUser: user ${uid} not found`)
}

async function archiveCustomerShadow(orgId: string, customerId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'UPDATE customers SET archived_at = $1, updated_at = $1 WHERE org_id = $2 AND id = $3',
      [now, orgId, customerId],
    )
  } finally {
    await client.end()
  }
}

async function seedCommissionWithSnapshot(
  org: SeededOrg,
  c: {
    attributedUserId: string
    attributedMemberName: string
    itemName: string
    createdAt: string
  },
): Promise<string> {
  const orderId = await seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: 5000,
    closedAt: c.createdAt,
  })
  return seedCommission({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    orderId,
    itemName: c.itemName,
    attributedMemberName: c.attributedMemberName,
  })
}

test.describe('Offboarding de membro — jornada Feature-level (#1102)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('Cenário 1: desligamento limpo — cascade completo + registros identificáveis', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const realName = 'Profissional 1'
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Jornada' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const past = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

    const futureAppt = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    const pastAppt = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: past,
      endAt: new Date(new Date(past).getTime() + 30 * 60_000).toISOString(),
    })
    const proBlock = await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'folga do profissional',
    })
    const orgBlock = await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: null,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'feriado',
    })
    const proUser = await readUser(proUserId)
    expect(proUser?.mobile, 'operational pro must have a seeded WhatsApp').toBeTruthy()
    const { inviteId } = await seedInvite({
      orgId: org.orgId,
      mobile: proUser!.mobile!,
      role: 'member_operator',
      invitedBy: org.uid,
      status: 'pending',
    })
    await seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte da Jornada',
      createdAt: new Date().toISOString(),
    })

    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoList()
    await expect(authedPage.getByText(realName)).toBeVisible()

    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    expect(await readMemberOperationByUserId(org.orgId, proUserId)).not.toBeNull()
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)

    await expect.poll(() => readAppointmentStatus(org.orgId, futureAppt)).toBe('cancelled')
    expect(await appointmentExists(org.orgId, futureAppt)).toBe(true)
    expect(await readAppointmentStatus(org.orgId, pastAppt)).toBe('scheduled')

    await expect.poll(() => blockExists(org.orgId, proBlock)).toBe(false)
    expect(await blockExists(org.orgId, orgBlock)).toBe(true)

    await expect.poll(() => inviteStillExists(org.orgId, inviteId)).toBe(false)

    await pros.gotoList()
    await expect(authedPage.getByText(realName)).toHaveCount(0)
    const publicBooking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
    await publicBooking.gotoUnit('unidade-1')
    await expect(authedPage.getByText(realName)).toHaveCount(0)

    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByText('Corte da Jornada')).toBeVisible()
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte da Jornada' })
    await expect(commissionRow.getByText(realName)).toBeVisible()
  })

  test('Cenário 2: comanda aberta recusa a remoção (comissão pendente NÃO bloqueia)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Comanda' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const apptId = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    const commissionOrderId = await seedClosedOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId: null,
      attributedUserId: proUserId,
      totalCents: 7000,
    })
    const pendingCommission = await seedCommission({
      orgId: org.orgId,
      attributedUserId: proUserId,
      amountCents: 3500,
      liquidationStatus: 'pendente',
      orderId: commissionOrderId,
    })
    await seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: proUserId,
    })

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    await expect(authedPage.getByText(/comanda aberta/i)).toBeVisible()
    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await readAppointmentStatus(org.orgId, apptId)).toBe('scheduled')
    expect(await readCommissionLiquidationStatus(org.orgId, pendingCommission)).toBe('pendente')
  })

  test('Cenário 3: identidade preservada e separada do cliente — as relações nunca cruzam', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const realName = 'Profissional 1'
    const now = new Date().toISOString()

    const customerShadowId = await seedCustomerShadowForUser(org.orgId, proUserId)
    await seedOrgLink(proUserId, org.orgId)

    await seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte Identidade',
      createdAt: now,
    })

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(revokedRow.getByText(realName)).toBeVisible()

    await anonymizeUser(proUserId)
    await archiveCustomerShadow(org.orgId, customerShadowId)

    expect(await blockedSubjectMarkerExists(org.orgId, proUserId)).toBe(true)
    expect(customerShadowId).toBeTruthy()

    const neutralLabel = anonymizedLabel(proUserId, 'Profissional')
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const afterRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(afterRow.getByText(realName)).toBeVisible()
    await expect(afterRow.getByText(neutralLabel)).toHaveCount(0)

    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)
  })
})
