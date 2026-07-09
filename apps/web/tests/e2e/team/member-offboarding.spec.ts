import { membershipDocId } from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CommissionConfig,
  InviteConfig,
  MemberOperationConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgProjectionExists,
  pgReadEventStream,
  pgReadProjection,
  readMemberOperationByUserId,
  readUser,
  seedAppointment,
  seedBlock,
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedInvite,
  seedOpenOrder,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

const MembershipStatusEventSchema = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  payload: Schema.optional(
    Schema.Struct({
      changes: Schema.optional(Schema.Struct({ status: Schema.optional(Schema.String) })),
    }),
  ),
})
const decodeMembershipStatusEvent = Schema.decodeUnknownSync(MembershipStatusEventSchema)

async function listMembershipStatusEvents(orgId: string, membershipId: string): Promise<string[]> {
  const stream = await pgReadEventStream(aggregateRef(MembershipConfig, orgId, membershipId))
  return stream
    .map((e) => decodeMembershipStatusEvent(e))
    .filter((e) => e._tag === 'membership.updated')
    .map((e) => e.payload?.changes?.status)
    .filter((s): s is string => typeof s === 'string')
}

async function memberOperationPiiExists(
  orgId: string,
  memberOperationId: string,
): Promise<boolean> {
  return pgProjectionExists(
    'member_operations_pii',
    aggregateRef(MemberOperationConfig, orgId, memberOperationId),
  )
}

async function readMembershipStatus(orgId: string, membershipId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  return typeof row?.status === 'string' ? row.status : null
}

async function readAppointmentStatus(orgId: string, appointmentId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'appointments',
    aggregateRef(AppointmentConfig, orgId, appointmentId),
  )
  return typeof row?.status === 'string' ? row.status : null
}

async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  return pgProjectionExists('agenda_blocks', aggregateRef(AgendaBlockConfig, orgId, blockId))
}

async function inviteExists(orgId: string, inviteId: string): Promise<boolean> {
  return pgProjectionExists('invites', aggregateRef(InviteConfig, orgId, inviteId))
}

test.describe('Equipe — offboarding de membro (#1103)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('owner remove membro → revoked + sai da equipe + PII retida + idempotente', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect((await readMemberOperationByUserId(org.orgId, proUserId))?.operationalStatus).toBe(
      'operational',
    )
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)
    expect(await listMembershipStatusEvents(org.orgId, membershipId)).toEqual([])

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoList()
    await expect(authedPage.getByText('Profissional 1')).toBeVisible()

    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')
    expect(await listMembershipStatusEvents(org.orgId, membershipId)).toContain('revoked')

    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')
    expect(await readMemberOperationByUserId(org.orgId, proUserId)).not.toBeNull()

    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)

    await pros.gotoList()
    await expect(authedPage.getByText('Profissional 1')).toHaveCount(0)

    const beforeCount = (await listMembershipStatusEvents(org.orgId, membershipId)).filter(
      (s) => s === 'revoked',
    ).length
    expect(beforeCount).toBe(1)
  })

  test('não é possível remover o owner (identidade imutável)', async ({ org, authedPage }) => {
    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(org.uid)
    await expect(authedPage.getByRole('form', { name: 'Remover do time' })).toHaveCount(0)
  })
})

test.describe('Equipe — cascade de offboarding (#1104)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('AC-05: comanda aberta recusa a remoção com mensagem (saga não inicia)', async ({
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
  })

  test('AC-02 + AC-07: remove → agenda futura cancelada (retida) + blocks limpos', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Agenda' })

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

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    await expect.poll(() => readAppointmentStatus(org.orgId, futureAppt)).toBe('cancelled')
    expect(
      await pgReadProjection(
        'appointments',
        aggregateRef(AppointmentConfig, org.orgId, futureAppt),
      ),
    ).not.toBeNull()
    expect(await readAppointmentStatus(org.orgId, pastAppt)).toBe('scheduled')

    await expect.poll(() => blockExists(org.orgId, proBlock)).toBe(false)
    expect(await blockExists(org.orgId, orgBlock)).toBe(true)
  })
})

test.describe('Equipe — cascade de offboarding (#1105)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('AC-06: comissão pendente NÃO bloqueia a remoção — comissão fica pendente e identificável', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    const orderId = await seedClosedOrder({
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
      orderId,
    })

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    const commission = await pgReadProjection(
      'commissions',
      aggregateRef(CommissionConfig, org.orgId, pendingCommission),
    )
    expect(commission?.liquidation_status).toBe('pendente')
    expect(commission?.attributed_user_id).toBe(proUserId)
  })

  test('AC-08: remover o único profissional da unidade avisa (sem bloquear)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    const submit = authedPage.getByRole('button', { name: 'Remover do time' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(authedPage.getByText(/sem profissional/i)).toBeVisible()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')
  })

  test('AC-09: invite pendente do membro (por WhatsApp) é limpo na remoção', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const proUser = await readUser(proUserId)
    const proWhatsapp = proUser?.mobile
    expect(proWhatsapp, 'operational pro must have a seeded WhatsApp').toBeTruthy()

    const { inviteId } = await seedInvite({
      orgId: org.orgId,
      mobile: proWhatsapp!,
      role: 'member_operator',
      invitedBy: org.uid,
      status: 'pending',
    })
    const { inviteId: otherInviteId } = await seedInvite({
      orgId: org.orgId,
      mobile: `5511977${proId.replace(/\D/g, '').slice(-6).padStart(6, '0')}`,
      role: 'receptionist',
      invitedBy: org.uid,
      status: 'pending',
    })

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    await expect.poll(() => inviteExists(org.orgId, inviteId)).toBe(false)
    expect(await inviteExists(org.orgId, otherInviteId)).toBe(true)
  })
})
