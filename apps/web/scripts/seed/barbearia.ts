// "Barbearia do Zé" — the primary, data-rich org. Exercises the full surface a
// tester needs locally: 3 units across all three agenda modes, a category, 4
// services + 2 products, a subscription plan (+3 cycle variants), 4 member
// operations onboarded through the invite-accept cascade (incl. one
// incomplete operator), a commissioned receptionist, 40+ customers with varied
// birthdays, an active subscription, appointments spread yesterday/today/
// tomorrow, recurring + one-off agenda blocks, and cash movements
// (despesa/sangria/suprimento).
//
// Everything is written through the canonical event-first path (org-base
// primitives + the saga helpers); ids are fixed so a re-run reproduces the
// exact same org (idempotent after the reset).

import { membershipDocId } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { putUser } from '@/shared/db/pg/users-store'
import { buildAppointment, buildMembership, buildUser } from '@/shared/fixtures/domain-builders'
import {
  agendaAlwaysOpen,
  agendaAppointment,
  buildAddress,
  buildAgendaBlockOneOff,
  buildAgendaBlockRecurring,
  buildCategory,
  buildExpenseMovement,
  buildOrderItem,
  buildOrg,
  buildProductItem,
  buildSangriaMovement,
  buildServiceItem,
  buildSubscriptionPlan,
  buildSuprimentoMovement,
  buildUnit,
} from '@/shared/fixtures/seed-domain-builders'
import { ensureAuthIdentity } from './auth'
import { seedClosedSale } from './closed-sale'
import { emitOne } from './emit'
import { seedMemberOperation } from './member-operation-saga'
import {
  seedAgendaBlock,
  seedAppointment,
  seedAppointmentOutcome,
  seedCashMovement,
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedOrgBilling,
  seedOrgWithOwner,
  seedPlan,
  seedSubscription,
  seedUnit,
} from './org-base'
import { daysFromNow, now } from './runtime'

const ORG_ID = 'seed-org'
const OWNER = {
  uid: 'seed-owner',
  email: 'dev@cbrl.local',
  displayName: 'Zé Owner',
  whatsapp: '5511999990000',
}

const UNIT_CENTRO = 'seed-unit-centro'
const UNIT_ZONA_SUL = 'seed-unit-zona-sul'
const UNIT_EXPRESSO = 'seed-unit-expresso'

const CAT_CABELO = 'seed-cat-cabelo'

const SVC_CORTE = 'seed-svc-corte'
const SVC_BARBA = 'seed-svc-barba'
const SVC_COMBO = 'seed-svc-combo'
const SVC_SOBRANCELHA = 'seed-svc-sobrancelha'
const PROD_POMADA = 'seed-prod-pomada'
const PROD_SHAMPOO = 'seed-prod-shampoo'

const PLAN_MENSAL = 'seed-plan-mensal'
const PLAN_TRIMESTRAL = 'seed-plan-trimestral'
const PLAN_SEMESTRAL = 'seed-plan-semestral'
const PLAN_ANUAL = 'seed-plan-anual'

const PRO_ZE = 'seed-user-ze'
const PRO_MARIA = 'seed-user-maria'
const PRO_JOAO = 'seed-user-joao'
const PRO_NOVO = 'seed-user-novo'
const RECEP = 'seed-user-recep'

const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elaine',
  'Felipe',
  'Gabi',
  'Heitor',
  'Igor',
  'Júlia',
  'Kaique',
  'Lara',
  'Marcos',
  'Natália',
  'Otávio',
  'Paula',
  'Quésia',
  'Rafael',
  'Sofia',
  'Tiago',
  'Ursula',
  'Vitor',
  'Wesley',
  'Yara',
]

export async function seedBarbearia(): Promise<void> {
  // — Org + owner (the owner logs in) —
  await ensureAuthIdentity(OWNER)
  await seedOrgWithOwner({
    org: buildOrg(ORG_ID, OWNER.uid, now, {
      name: 'Barbearia do Zé',
      slug: 'barbearia-do-ze',
      vertical: 'barbershop',
    }),
    owner: OWNER,
    now,
  })

  // Assinatura Oilio: the showcase org is on Avançado so the gated paid surfaces
  // (planos, comissões, copiloto, relatórios, multi-unidade) are unlocked — it
  // has 3 units below. Without this, gating (brief 0072) would lock the rich
  // demo down to Free. The isolation orgs below stay Free on purpose, to also
  // exercise the gate. (3 units → unitQuantity 3.)
  await seedOrgBilling({
    orgId: ORG_ID,
    tier: 'advanced',
    unitQuantity: 3,
    actorId: OWNER.uid,
    now,
  })

  // — Units: appointment (Centro/Zona Sul) + always_open (Expresso) —
  // Centro/Zona Sul are appointment units publicly live for self-booking (real
  // address + open hours → `isUnitPubliclyLive`, no publish flag) so the public
  // booking flow is live out of the box. Every unit carries a COMPLETE address —
  // a unit with a blank address is not publicly live (`isAddressComplete`).
  await seedUnit(
    buildUnit(UNIT_CENTRO, ORG_ID, now, {
      name: 'Centro',
      slug: 'centro',
      address: buildAddress({ neighborhood: 'Centro', street: 'Rua XV de Novembro' }),
      agenda: agendaAppointment(),
    }),
    OWNER.uid,
  )
  await seedUnit(
    buildUnit(UNIT_ZONA_SUL, ORG_ID, now, {
      name: 'Zona Sul',
      slug: 'zona-sul',
      address: buildAddress({ neighborhood: 'Moema', street: 'Avenida Ibirapuera' }),
      agenda: agendaAppointment(),
    }),
    OWNER.uid,
  )
  await seedUnit(
    buildUnit(UNIT_EXPRESSO, ORG_ID, now, {
      name: 'Expresso',
      slug: 'expresso',
      address: buildAddress({ neighborhood: 'Pinheiros', street: 'Rua dos Pinheiros' }),
      agenda: agendaAlwaysOpen(),
    }),
    OWNER.uid,
  )

  // — Category + catalog (4 services, 2 products) —
  await seedCategory(buildCategory(CAT_CABELO, ORG_ID, now, { name: 'Cabelo' }), OWNER.uid)

  const allUnits = [UNIT_CENTRO, UNIT_ZONA_SUL, UNIT_EXPRESSO]
  await seedCatalogItem(
    buildServiceItem(SVC_CORTE, ORG_ID, now, {
      name: 'Corte',
      categoryId: CAT_CABELO,
      priceCents: 4500,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )
  await seedCatalogItem(
    buildServiceItem(SVC_BARBA, ORG_ID, now, {
      name: 'Barba',
      categoryId: CAT_CABELO,
      priceCents: 3000,
      durationMinutes: 20,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )
  await seedCatalogItem(
    buildServiceItem(SVC_COMBO, ORG_ID, now, {
      name: 'Combo (Corte + Barba)',
      categoryId: CAT_CABELO,
      priceCents: 7000,
      durationMinutes: 50,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )
  await seedCatalogItem(
    buildServiceItem(SVC_SOBRANCELHA, ORG_ID, now, {
      name: 'Sobrancelha',
      categoryId: CAT_CABELO,
      priceCents: 2000,
      durationMinutes: 15,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )
  await seedCatalogItem(
    buildProductItem(PROD_POMADA, ORG_ID, now, {
      name: 'Pomada Modeladora',
      priceCents: 3500,
      stock: 40,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )
  await seedCatalogItem(
    buildProductItem(PROD_SHAMPOO, ORG_ID, now, {
      name: 'Shampoo Premium',
      priceCents: 2800,
      stock: 25,
      unitIds: allUnits,
    }),
    OWNER.uid,
  )

  // — Plans: monthly base + cycle variants —
  const monthlyPlan = buildSubscriptionPlan(PLAN_MENSAL, ORG_ID, now, {
    name: 'Plano Mensal Corte',
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [SVC_CORTE],
    usageLimit: { kind: 'count', quantity: 4 },
  })
  await seedPlan(monthlyPlan, OWNER.uid)
  await seedPlan(
    buildSubscriptionPlan(PLAN_TRIMESTRAL, ORG_ID, now, {
      name: 'Plano Trimestral Corte',
      priceCents: 26900,
      billingCycle: 'quarterly',
      includedItemIds: [SVC_CORTE],
      usageLimit: { kind: 'count', quantity: 12 },
    }),
    OWNER.uid,
  )
  await seedPlan(
    buildSubscriptionPlan(PLAN_SEMESTRAL, ORG_ID, now, {
      name: 'Plano Semestral Corte+Barba',
      priceCents: 49900,
      billingCycle: 'semiannual',
      includedItemIds: [SVC_CORTE, SVC_BARBA],
      usageLimit: { kind: 'unlimited' },
    }),
    OWNER.uid,
  )
  await seedPlan(
    buildSubscriptionPlan(PLAN_ANUAL, ORG_ID, now, {
      name: 'Plano Anual VIP',
      priceCents: 89900,
      billingCycle: 'annual',
      includedCategoryIds: [CAT_CABELO],
      usageLimit: { kind: 'unlimited' },
    }),
    OWNER.uid,
  )

  // — Member operations via the invite-accept cascade —
  // Zé, Maria, João are complete; "Novo" is incomplete (no whatsapp → derived
  // operational status not-ready). The receptionist gets a membership only.
  await ensureAuthIdentity({ uid: PRO_ZE, email: 'ze.pro@cbrl.local', displayName: 'Zé Barbeiro' })
  const proZeId = await seedMemberOperation({
    orgId: ORG_ID,
    memberOperationId: 'seed-pro-ze',
    userId: PRO_ZE,
    displayName: 'Zé Barbeiro',
    whatsapp: '5511988880001',
    unitIds: [UNIT_CENTRO, UNIT_ZONA_SUL],
    catalogServiceIds: [SVC_CORTE, SVC_BARBA, SVC_COMBO],
    defaultCommission: { kind: 'percentage', value: 50 },
    invitedBy: OWNER.uid,
    now,
  })
  const proMariaId = await seedMemberOperation({
    orgId: ORG_ID,
    memberOperationId: 'seed-pro-maria',
    userId: PRO_MARIA,
    displayName: 'Maria Tesoura',
    whatsapp: '5511988880002',
    unitIds: [UNIT_CENTRO],
    catalogServiceIds: [SVC_CORTE, SVC_SOBRANCELHA],
    defaultCommission: { kind: 'percentage', value: 45 },
    invitedBy: OWNER.uid,
    now,
  })
  const proJoaoId = await seedMemberOperation({
    orgId: ORG_ID,
    memberOperationId: 'seed-pro-joao',
    userId: PRO_JOAO,
    displayName: 'João Navalha',
    whatsapp: '5511988880003',
    unitIds: [UNIT_ZONA_SUL, UNIT_EXPRESSO],
    catalogServiceIds: [SVC_BARBA, SVC_COMBO],
    defaultCommission: { kind: 'fixed', value: 1500 },
    invitedBy: OWNER.uid,
    now,
  })
  await seedMemberOperation({
    orgId: ORG_ID,
    memberOperationId: 'seed-pro-novo',
    userId: PRO_NOVO,
    displayName: 'Novo Recruta',
    whatsapp: null,
    unitIds: [],
    catalogServiceIds: [],
    invitedBy: OWNER.uid,
    now,
  })

  // Receptionist — a commissionable NON-operator member (logs in). She gets
  // a membership with role `receptionist` and NO `member_operations` row: a
  // receptionist rings up sales / earns commission but performs no services, so
  // she must never become a bookable agenda column. Emitted inline (membership +
  // the global `users` identity) rather than via `seedMemberOperation`, which is
  // operator-only (it always mints a `member_operations` row + role
  // `member_operator`). Mirrors the production invite-accept path, where a
  // member-operation row is created iff the invite role is `member_operator`.
  await ensureAuthIdentity({ uid: RECEP, email: 'recep@cbrl.local', displayName: 'Paula Recepção' })
  await emitOne(MembershipConfig, ORG_ID, membershipDocId(ORG_ID, RECEP), {
    _tag: 'membership.created',
    actorId: OWNER.uid,
    payload: {
      data: buildMembership(ORG_ID, RECEP, now, { role: 'receptionist', invitedBy: OWNER.uid }),
    },
  })
  await putUser(
    buildUser(RECEP, now, {
      displayName: 'Paula Recepção',
      completionCompleted: true,
      whatsapp: '5511977770000',
      currentOrgId: ORG_ID,
    }),
  )

  // — Customers: 4 named (one logs in) + ~36 generated with varied birthdays —
  await ensureAuthIdentity({
    uid: 'seed-cust-1-user',
    email: 'cliente@cbrl.local',
    displayName: 'Cliente Demo',
  })
  const namedCustomers = [
    {
      id: 'seed-cust-1',
      user: 'seed-cust-1-user',
      name: 'Cliente Demo',
      whatsapp: '5511966660001',
      birthDate: '1990-03-15',
    },
    {
      id: 'seed-cust-2',
      user: 'seed-cust-2-user',
      name: 'Roberto Cliente',
      whatsapp: '5511966660002',
      birthDate: '1985-07-22',
    },
    {
      id: 'seed-cust-3',
      user: 'seed-cust-3-user',
      name: 'Fernanda Souza',
      whatsapp: '5511966660003',
      birthDate: '1995-11-08',
    },
    {
      id: 'seed-cust-4',
      user: 'seed-cust-4-user',
      name: 'Carlos Pereira',
      whatsapp: '5511966660004',
      birthDate: '1978-01-30',
    },
  ]
  for (const c of namedCustomers) {
    await seedCustomer({
      id: c.id,
      orgId: ORG_ID,
      userId: c.user,
      displayName: c.name,
      whatsapp: c.whatsapp,
      birthDate: c.birthDate,
      now,
      actorId: OWNER.uid,
    })
  }
  for (let i = 0; i < 36; i++) {
    const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${i + 1}`
    const month = String((i % 12) + 1).padStart(2, '0')
    const day = String((i % 27) + 1).padStart(2, '0')
    await seedCustomer({
      id: `seed-cust-gen-${i}`,
      orgId: ORG_ID,
      userId: `seed-cust-gen-${i}-user`,
      displayName: name,
      whatsapp: `55119${String(100000 + i).padStart(8, '0')}`,
      birthDate: `199${i % 10}-${month}-${day}`,
      now,
      actorId: OWNER.uid,
    })
  }

  // — Active subscription (named customer 1 on the monthly plan) —
  await seedSubscription({
    id: 'seed-sub-1',
    orgId: ORG_ID,
    unitId: UNIT_CENTRO,
    customerId: 'seed-cust-1',
    customerUserId: 'seed-cust-1-user',
    plan: monthlyPlan,
    periodStart: now,
    periodEnd: daysFromNow(30),
    nextChargeDate: daysFromNow(30),
    actorId: OWNER.uid,
  })

  // — Appointments spread across yesterday / today / tomorrow —
  // `memberOperationId` references `member_operations.id` (FK), NOT the user id;
  // `memberOperatorUserId` carries the global user id (the agenda's "mine" bridge).
  // Agenda realista ao redor do dia real (#B2): o passado carrega SEMPRE um
  // desfecho terminal (atendido/ausente/cancelado) — nunca `scheduled` no
  // passado, que seria o furo "passou da hora e ninguém marcou"; hoje mistura os
  // horários da manhã já atendidos (`completed`) com os da tarde ainda por vir
  // (`scheduled`); o futuro é `scheduled`. `outcome` é aplicado como transição
  // pós-`created` (o create sozinho sempre projeta `scheduled`).
  const appts = [
    // — Passado (anteontem): dia cheio, majoritariamente atendido + 1 ausência —
    {
      id: 'seed-appt-p1',
      pro: proZeId,
      proUser: PRO_ZE,
      cust: 'seed-cust-1',
      custUser: 'seed-cust-1-user',
      svc: SVC_CORTE,
      day: -2,
      hour: 9,
      outcome: 'completed' as const,
    },
    {
      id: 'seed-appt-p2',
      pro: proMariaId,
      proUser: PRO_MARIA,
      cust: 'seed-cust-2',
      custUser: 'seed-cust-2-user',
      svc: SVC_SOBRANCELHA,
      day: -2,
      hour: 15,
      outcome: 'no_show' as const,
    },
    // — Passado (ontem): atendido + 1 cancelamento —
    {
      id: 'seed-appt-p3',
      pro: proZeId,
      proUser: PRO_ZE,
      cust: 'seed-cust-3',
      custUser: 'seed-cust-3-user',
      svc: SVC_COMBO,
      day: -1,
      hour: 10,
      outcome: 'completed' as const,
    },
    {
      id: 'seed-appt-p4',
      pro: proJoaoId,
      proUser: PRO_JOAO,
      cust: 'seed-cust-4',
      custUser: 'seed-cust-4-user',
      svc: SVC_BARBA,
      day: -1,
      hour: 14,
      outcome: 'cancelled' as const,
    },
    // — Hoje: manhã já atendida, tarde ainda agendada —
    {
      id: 'seed-appt-t1',
      pro: proZeId,
      proUser: PRO_ZE,
      cust: 'seed-cust-1',
      custUser: 'seed-cust-1-user',
      svc: SVC_CORTE,
      day: 0,
      hour: 9,
      outcome: 'completed' as const,
    },
    {
      id: 'seed-appt-t2',
      pro: proMariaId,
      proUser: PRO_MARIA,
      cust: 'seed-cust-2',
      custUser: 'seed-cust-2-user',
      svc: SVC_SOBRANCELHA,
      day: 0,
      hour: 15,
      outcome: 'scheduled' as const,
    },
    {
      id: 'seed-appt-t3',
      pro: proZeId,
      proUser: PRO_ZE,
      cust: 'seed-cust-3',
      custUser: 'seed-cust-3-user',
      svc: SVC_COMBO,
      day: 0,
      hour: 17,
      outcome: 'scheduled' as const,
    },
    // — Futuro: amanhã + depois —
    {
      id: 'seed-appt-f1',
      pro: proJoaoId,
      proUser: PRO_JOAO,
      cust: 'seed-cust-4',
      custUser: 'seed-cust-4-user',
      svc: SVC_BARBA,
      day: 1,
      hour: 9,
      outcome: 'scheduled' as const,
    },
    {
      id: 'seed-appt-f2',
      pro: proMariaId,
      proUser: PRO_MARIA,
      cust: 'seed-cust-1',
      custUser: 'seed-cust-1-user',
      svc: SVC_CORTE,
      day: 2,
      hour: 16,
      outcome: 'scheduled' as const,
    },
  ]
  for (const a of appts) {
    const startAt = daysFromNow(a.day, a.hour)
    await seedAppointment(
      buildAppointment(a.id, ORG_ID, now, {
        unitId: UNIT_CENTRO,
        memberOperationId: a.pro,
        memberOperatorUserId: a.proUser,
        customerId: a.cust,
        customerUserId: a.custUser,
        serviceId: a.svc,
        startAt,
        endAt: daysFromNow(a.day, a.hour + 1),
        // `created` always projects `scheduled`; the terminal outcome is applied
        // right after via `seedAppointmentOutcome` (event-first, like production).
        status: 'scheduled',
        servicePriceCentsSnapshot: 4500,
        serviceDurationMinutesSnapshot: 30,
      }),
      OWNER.uid,
    )
    // The outcome is timestamped at the appointment's end (a plausible moment for
    // the operator to have marked it).
    await seedAppointmentOutcome({
      orgId: ORG_ID,
      appointmentId: a.id,
      outcome: a.outcome,
      atIso: daysFromNow(a.day, a.hour + 1),
      actorId: OWNER.uid,
    })
  }

  // — Agenda blocks: recurring lunch (Mon/Wed/Fri) + a one-off tomorrow —
  for (const [i, weekday] of (['monday', 'wednesday', 'friday'] as const).entries()) {
    await seedAgendaBlock(
      buildAgendaBlockRecurring({
        id: `seed-block-lunch-${weekday}`,
        orgId: ORG_ID,
        unitId: UNIT_CENTRO,
        weekday,
        open: '12:00',
        close: '13:00',
        now,
        overrides: { reason: 'Almoço', memberOperationId: i === 0 ? proZeId : null },
      }),
      OWNER.uid,
    )
  }
  await seedAgendaBlock(
    buildAgendaBlockOneOff({
      id: 'seed-block-medico',
      orgId: ORG_ID,
      unitId: UNIT_CENTRO,
      startAt: daysFromNow(1, 15),
      endAt: daysFromNow(1, 17),
      now,
      overrides: { reason: 'Consulta médica', memberOperationId: proZeId },
    }),
    OWNER.uid,
  )

  // — Cash movements: despesa, sangria, suprimento —
  await seedCashMovement(
    buildExpenseMovement(
      {
        id: 'seed-cash-despesa-1',
        orgId: ORG_ID,
        unitId: UNIT_CENTRO,
        recordedByUid: OWNER.uid,
        amountCents: 15000,
        now,
        description: 'Conta de luz',
      },
      'utilities',
    ),
    OWNER.uid,
  )
  await seedCashMovement(
    buildSangriaMovement({
      id: 'seed-cash-sangria-1',
      orgId: ORG_ID,
      unitId: UNIT_CENTRO,
      recordedByUid: OWNER.uid,
      amountCents: 20000,
      now,
      description: 'Sangria fim de dia',
    }),
    OWNER.uid,
  )
  await seedCashMovement(
    buildSuprimentoMovement({
      id: 'seed-cash-suprimento-1',
      orgId: ORG_ID,
      unitId: UNIT_CENTRO,
      recordedByUid: OWNER.uid,
      amountCents: 10000,
      now,
      description: 'Troco inicial',
    }),
    OWNER.uid,
  )

  // — One closed sale (corte by Zé + pomada) to populate the register/commissions —
  await seedClosedSale({
    orderId: 'seed-order-1',
    orgId: ORG_ID,
    unitId: UNIT_CENTRO,
    customerId: 'seed-cust-2',
    items: [
      buildOrderItem('seed-oi-1', PRO_ZE, {
        kind: 'service',
        refId: SVC_CORTE,
        name: 'Corte',
        unitPriceCents: 4500,
        commission: { kind: 'percentage', value: 50 },
      }),
      buildOrderItem('seed-oi-2', RECEP, {
        kind: 'product',
        refId: PROD_POMADA,
        name: 'Pomada Modeladora',
        unitPriceCents: 3500,
        commission: null,
      }),
    ],
    paymentMethod: 'pix',
    recordedByUid: RECEP,
    memberNames: { [PRO_ZE]: 'Zé Barbeiro', [RECEP]: 'Paula Recepção' },
    now,
  })
}
