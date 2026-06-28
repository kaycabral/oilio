// Shared emission primitives every org module composes — each wraps a single
// canonical write (`emitEvent`) or an ACID cascade (`commitSaga`) through the
// SAME path production uses, so the seed never side-writes a projection. PII
// (user identity) lands in the `users` table; the event payloads stay PII-free.
//
// These cover the single-aggregate creates (org, unit, category, catalog item,
// plan, customer, subscription, appointment, agenda block, cash movement). The
// multi-aggregate cascades (professional onboarding, closed sale) live in their
// own helpers (`professional-saga.ts`, `closed-sale.ts`).

import {
  buildPlanSnapshot,
  membershipDocId,
  type AgendaBlock,
  type Appointment,
  type CashMovement,
  type CatalogProductItem,
  type CatalogServiceItem,
  type Category,
  type StoredOrg,
  type StoredUnit,
  type SubscriptionPlan,
} from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CashMovementConfig,
  CatalogItemConfig,
  CategoryConfig,
  CustomerConfig,
  MembershipConfig,
  OrgBillingConfig,
  OrgConfig,
  SubscriptionConfig,
  SubscriptionPlanConfig,
  UnitConfig,
} from '@/domain/aggregates'
import { appendEventToTx, aggregateRef as ref, type SagaStep } from '@/domain/effect'
import { putUser } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { buildMembership, buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { emitOne } from './emit'

// Org + owner onboarding — the canonical multi-aggregate cascade (org.created +
// membership.created) as ONE ACID transaction, mirroring production onboarding.
// The owner's global `users` identity (PII) is written post-commit.
export async function seedOrgWithOwner(args: {
  org: StoredOrg
  owner: { uid: string; displayName: string; whatsapp: string }
  now: string
}): Promise<void> {
  const { org, owner, now } = args
  const membership = buildMembership(org.id, owner.uid, now, { role: 'owner' })

  const orgStep: SagaStep = (tx) =>
    appendEventToTx(
      OrgConfig,
      ref(OrgConfig, org.id, org.id),
      { _tag: 'org.created', actorId: owner.uid, payload: { data: org } },
      tx,
    )
  const membershipStep: SagaStep = (tx) =>
    appendEventToTx(
      MembershipConfig,
      ref(MembershipConfig, org.id, membershipDocId(org.id, owner.uid)),
      { _tag: 'membership.created', actorId: owner.uid, payload: { data: membership } },
      tx,
    )

  const outcome = await commitSaga([orgStep, membershipStep])
  if (!outcome.ok) throw new Error(`seedOrgWithOwner failed for ${org.id}: ${outcome.error}`)

  await putUser(
    buildUser(owner.uid, now, {
      displayName: owner.displayName,
      completionCompleted: true,
      whatsapp: owner.whatsapp,
      currentOrgId: org.id,
    }),
  )
}

export function seedUnit(unit: StoredUnit, actorId: string): Promise<void> {
  return emitOne(UnitConfig, unit.orgId, unit.id, {
    _tag: 'unit.created',
    actorId,
    payload: { data: unit },
  })
}

export function seedCategory(category: Category, actorId: string): Promise<void> {
  return emitOne(CategoryConfig, category.orgId, category.id, {
    _tag: 'category.created',
    actorId,
    payload: { data: category },
  })
}

export function seedCatalogItem(
  item: CatalogServiceItem | CatalogProductItem,
  actorId: string,
): Promise<void> {
  return emitOne(CatalogItemConfig, item.orgId, item.id, {
    _tag: 'catalog_item.created',
    actorId,
    payload: { data: item },
  })
}

export function seedPlan(plan: SubscriptionPlan, actorId: string): Promise<void> {
  return emitOne(SubscriptionPlanConfig, plan.orgId, plan.id, {
    _tag: 'subscription_plan.created',
    actorId,
    payload: { data: plan },
  })
}

// Assinatura Oilio (brief 0072/0073). A Negócio with no org_billing row is Free
// by default (getOrgBilling), so the gating locks the paid surfaces. The rich
// demo org needs a PAID tier seeded so plans/commissions/copilot/reports show up
// — otherwise the seed looks "broken" under gating. Writes the row the Stripe
// webhook would, via the canonical event path (no Stripe object needed for dev).
export function seedOrgBilling(args: {
  orgId: string
  tier: 'pro' | 'advanced'
  unitQuantity: number
  actorId: string
  now: string
}): Promise<void> {
  const { orgId, tier, unitQuantity, actorId, now } = args
  return emitOne(OrgBillingConfig, orgId, orgId, {
    _tag: 'org_billing.activated',
    actorId,
    payload: {
      data: {
        id: orgId,
        orgId,
        tier,
        status: 'active',
        billingCycle: 'monthly',
        unitQuantity,
        // Dev seed has no real Stripe objects. stripeCustomerId null => the
        // /settings/billing panel shows the "subscribe" path (no portal); prod
        // gets these from the webhook. The tier alone drives the gating.
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  })
}

// Customer = global `users` identity (PII) + the per-org `customer.created`
// projection (operational only, references the user by id).
export async function seedCustomer(args: {
  id: string
  orgId: string
  userId: string
  displayName: string
  whatsapp: string | null
  birthDate: string | null
  now: string
  actorId: string
}): Promise<void> {
  await putUser(
    buildUser(args.userId, args.now, {
      displayName: args.displayName,
      completionCompleted: args.whatsapp !== null && args.birthDate !== null,
      whatsapp: args.whatsapp,
      birthDate: args.birthDate,
    }),
  )
  await emitOne(CustomerConfig, args.orgId, args.id, {
    _tag: 'customer.created',
    actorId: args.actorId,
    payload: { data: buildStoredCustomer(args.id, args.orgId, args.userId, args.now) },
  })
}

// Active subscription — the `subscription.created` payload is FLAT (not `{ data
// }`), carrying the frozen plan snapshot derived from the plan definition.
export async function seedSubscription(args: {
  id: string
  orgId: string
  unitId: string
  customerId: string
  customerUserId: string | null
  plan: SubscriptionPlan
  periodStart: string
  periodEnd: string
  nextChargeDate: string | null
  pastDueThreshold?: number
  actorId: string
}): Promise<void> {
  return emitOne(SubscriptionConfig, args.orgId, args.id, {
    _tag: 'subscription.created',
    actorId: args.actorId,
    payload: {
      id: args.id,
      orgId: args.orgId,
      unitId: args.unitId,
      customerId: args.customerId,
      customerUserId: args.customerUserId,
      planId: args.plan.id,
      plan: buildPlanSnapshot(args.plan),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      nextChargeDate: args.nextChargeDate,
      pastDueThreshold: args.pastDueThreshold ?? 2,
    },
  })
}

export function seedAppointment(appointment: Appointment, actorId: string): Promise<void> {
  return emitOne(AppointmentConfig, appointment.orgId, appointment.id, {
    _tag: 'appointment.created',
    actorId,
    payload: { data: appointment },
  })
}

export function seedAgendaBlock(block: AgendaBlock, actorId: string): Promise<void> {
  return emitOne(AgendaBlockConfig, block.orgId, block.id, {
    _tag: 'agenda_block.created',
    actorId,
    payload: { data: block },
  })
}

export function seedCashMovement(movement: CashMovement, actorId: string): Promise<void> {
  return emitOne(CashMovementConfig, movement.orgId, movement.id, {
    _tag: 'cash_movement.created',
    actorId,
    payload: { data: movement },
  })
}
