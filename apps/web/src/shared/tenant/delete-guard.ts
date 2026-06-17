// Active-reference delete guard (brief 0033, AC-01/AC-02 — #1068).
//
// A piece of master data (subscription-plan, catalog-item, unit) can be
// hard-deleted ONLY when nothing holds an **active** reference to it. A
// historical reference (cancelled subscription, closed/cancelled order,
// past/completed appointment) does NOT block: snapshot-on-use (ADR 0010 D3/D5)
// already froze the definition into the transactional record, so deleting the
// definition never loses history. Archive remains the path for in-use records.
//
// This module is the single source of truth for the distinction. Both the
// delete server actions (write authorization, AC-02 defense-in-depth) and the
// list/read layer that precomputes the per-row `canDelete` flag (AC-03, #1070)
// call `canDelete*` here so the UI's offered action and the server's rejection
// can never drift apart.
//
// Query discipline (ADR 0004): every query starts at `tenants/{tenantId}` —
// never `collectionGroup` on operational data. We use `.limit(1)` existence
// probes; the moment one active reference is found we stop.

import {
  AppointmentStatus,
  Membership,
  Subscription,
  isActiveMembershipStatus,
  isActiveSubscriptionStatus,
  isFutureScheduledAppointment,
  membershipDocId,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'

// The slice of an appointment doc the future-scheduled predicate needs.
const ApptProbe = Schema.Struct({ status: AppointmentStatus, startAt: Schema.String })

// Minimal projections for the catalog-item / customer probes.
const OrderItemsProbe = Schema.Struct({
  items: Schema.optional(Schema.Array(Schema.Struct({ refId: Schema.optional(Schema.String) }))),
})
const OrderStatusProbe = Schema.Struct({ status: Schema.String })
const ProUserIdProbe = Schema.Struct({ userId: Schema.optional(Schema.String) })

function tenantRef(tenantId: string) {
  return getAdminFirestore().collection('tenants').doc(tenantId)
}

// Future-scheduled appointment probe shared by the professional and customer
// guards: both denormalize the FK directly on the appointment doc
// (`professionalId` / `customerId`), so we filter by `scheduled` in the query
// then drop past-dated slots in memory via the shared predicate. Completed /
// cancelled / no-show and past `scheduled` slots are historical (the
// appointment snapshotted price/duration/commission), so they never block.
async function hasFutureScheduledAppointment(
  tenantId: string,
  field: 'professionalId' | 'customerId',
  id: string,
): Promise<boolean> {
  const appts = await tenantRef(tenantId)
    .collection('appointments')
    .where(field, '==', id)
    .where('status', '==', 'scheduled')
    .withConverter(fsConverter(ApptProbe))
    .get()
  return appts.docs.map((d) => d.data()).some((data) => isFutureScheduledAppointment(data))
}

// Row shape the list/read layer attaches the precomputed per-record flag to
// (brief 0033, AC-03 — #1070 consumes it to render Excluir XOR Arquivar without
// re-deriving). `canDelete` here is the *reference-based* flag (no active
// reference), orthogonal to the role-based "owner may delete" page gate.
export type WithCanDelete<T> = T & { canDelete: boolean }

// Batch-attach `canDelete` to a list of rows, resolving each row's active
// reference with the entity-specific probe. Kept generic so each page maps its
// own collection. Probes run in parallel (Promise.all) so a long list doesn't
// serialize the existence checks.
export async function attachCanDelete<T extends { id: string }>(
  rows: T[],
  hasActiveReference: (id: string) => Promise<boolean>,
): Promise<WithCanDelete<T>[]> {
  const flags = await Promise.all(rows.map((row) => hasActiveReference(row.id)))
  return rows.map((row, i) => ({ ...row, canDelete: !flags[i] }))
}

// ── Subscription plan ──────────────────────────────────────────────────────
// Active reference = a non-terminal subscription whose frozen snapshot points
// at this plan (`plan.planId`). A cancelled / cancelled_for_non_payment
// subscription is historical and keeps the plan resolvable via its own
// snapshot, so it does not block.
export async function planHasActiveReference(tenantId: string, planId: string): Promise<boolean> {
  const snap = await tenantRef(tenantId)
    .collection('subscriptions')
    .where('plan.planId', '==', planId)
    .withConverter(fsConverter(Subscription))
    .get()
  return snap.docs.map((d) => d.data()).some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeletePlan(tenantId: string, planId: string): Promise<boolean> {
  return !(await planHasActiveReference(tenantId, planId))
}

// ── Catalog item ───────────────────────────────────────────────────────────
// Active reference = (a) an OPEN order with a line item referencing it, or
// (b) an active subscription whose frozen coverage snapshot includes it. A
// closed/cancelled order is historical (its OrderItem snapshot froze
// name/price/commission); a plan *definition* that merely lists the item is
// editable config, not an active reference (the owner can repoint the plan),
// so plan coverage alone no longer blocks — only an active subscriber's frozen
// coverage does (brief 0033 risk note: "comanda aberta + cobertura de
// assinatura ativa").
export async function catalogItemHasActiveReference(
  tenantId: string,
  catalogItemId: string,
): Promise<boolean> {
  const tenant = tenantRef(tenantId)
  // (a) Open orders referencing the item in any line. `items` is an array of
  // objects, so we scope by open status and scan the (small) open-order set.
  const openOrders = await tenant
    .collection('orders')
    .where('status', '==', 'open')
    .withConverter(fsConverter(OrderItemsProbe))
    .get()
  const inOpenOrder = openOrders.docs
    .map((d) => d.data())
    .some((o) => (o.items ?? []).some((it) => it.refId === catalogItemId))
  if (inOpenOrder) return true

  // (b) Active subscriptions whose frozen `plan.includedItemIds` snapshot
  // covers the item.
  const covering = await tenant
    .collection('subscriptions')
    .where('plan.includedItemIds', 'array-contains', catalogItemId)
    .withConverter(fsConverter(Subscription))
    .get()
  return covering.docs.map((d) => d.data()).some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeleteCatalogItem(
  tenantId: string,
  catalogItemId: string,
): Promise<boolean> {
  return !(await catalogItemHasActiveReference(tenantId, catalogItemId))
}

// ── Unit ───────────────────────────────────────────────────────────────────
// Active reference = a FUTURE scheduled appointment in the unit, OR a
// professional currently scoped to it (lifecycle/offboarding is non-destructive
// elsewhere — an active pro in the unit is a live dependency). Past/completed/
// cancelled appointments are historical (snapshotted) and do not block. Catalog
// items offered in the unit are editable config (the owner repoints `unitIds`),
// so they no longer block on their own.
export async function unitHasActiveReference(tenantId: string, unitId: string): Promise<boolean> {
  const tenant = tenantRef(tenantId)
  // Professional actively scoped to the unit → live dependency.
  const pros = await tenant
    .collection('professionals')
    .where('unitIds', 'array-contains', unitId)
    .limit(1)
    .get()
  if (!pros.empty) return true

  // Future scheduled appointment in the unit. Filter by `scheduled` status in
  // the query, then drop past-dated ones in memory via the shared predicate.
  const appts = await tenant
    .collection('appointments')
    .where('unitId', '==', unitId)
    .where('status', '==', 'scheduled')
    .withConverter(fsConverter(ApptProbe))
    .get()
  return appts.docs.map((d) => d.data()).some((data) => isFutureScheduledAppointment(data))
}

export async function canDeleteUnit(tenantId: string, unitId: string): Promise<boolean> {
  return !(await unitHasActiveReference(tenantId, unitId))
}

// ── Professional ─────────────────────────────────────────────────────────────
// Active reference (brief 0033, AC-06) = (a) a FUTURE scheduled appointment
// assigned to them, OR (b) an ACTIVE membership (they're still a current team
// member). Both mean a live dependency that hard-delete would orphan; the
// lifecycle path is deactivate (0029 `suspended`) / offboard (0041 `revoked`),
// never erase. A REVOKED membership is the terminal severance (offboarding ran),
// and the offboarding cascade already cancelled future appointments — so a
// fully-offboarded professional has no active reference and becomes deletable.
// Past/completed/cancelled appointments are historical (snapshotted) and do not
// block. This is HARD delete vs archive, distinct from the LGPD anonymize
// (professional PII is RETAINED for legal retention, brief 0041 — there is no
// professional anonymization here).
//
// `professionalId` is the professional DOC id; appointments denormalize it as
// `professionalId`. Membership is keyed by the professional's `userId` (the
// projection always carries a non-null link, #1045) at `memberships/{tid}_{uid}`.
export async function professionalHasActiveReference(
  tenantId: string,
  professionalId: string,
): Promise<boolean> {
  if (await hasFutureScheduledAppointment(tenantId, 'professionalId', professionalId)) return true

  const proSnap = await tenantRef(tenantId)
    .collection('professionals')
    .doc(professionalId)
    .withConverter(fsConverter(ProUserIdProbe))
    .get()
  const userId = proSnap.data()?.userId
  if (!userId) return false

  const memberSnap = await getAdminFirestore()
    .collection('memberships')
    .doc(membershipDocId(tenantId, userId))
    .withConverter(fsConverter(Membership))
    .get()
  const member = memberSnap.data()
  return member ? isActiveMembershipStatus(member.status) : false
}

export async function canDeleteProfessional(
  tenantId: string,
  professionalId: string,
): Promise<boolean> {
  return !(await professionalHasActiveReference(tenantId, professionalId))
}

// ── Customer (operator delete — brief 0033, AC-07) ───────────────────────────
// Operator "Excluir cliente" is operational cleanup, NOT the LGPD erasure (brief
// 0032 — subject-only, self-service, identifiable name preserved here). The ONLY
// hard blocker is an OPEN comanda: a fiscal document in progress must not be
// orphaned by removing the customer (mapa Ciclo de Vida e Exclusão — the single
// rule shared with the LGPD block AC-11e and professional offboarding 0041).
//
// An active subscription + future appointments do NOT block — they are
// cascade-cancelled (`eraseCustomerCascadeInTenant`) and listed in the confirm
// dialog (AC-10) so the operator sees the impact first. The deletion itself then
// chooses hard-delete (no footprint) vs cascade + soft-archive (`deactivatedAt`,
// name kept) — see `deleteCustomer`. `customerId` is the per-tenant shadow id.
export async function customerHasOpenComanda(
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const openOrders = await tenantRef(tenantId)
    .collection('orders')
    .where('customerId', '==', customerId)
    .where('status', '==', 'open')
    .limit(1)
    .get()
  return !openOrders.empty
}

export async function canDeleteCustomer(tenantId: string, customerId: string): Promise<boolean> {
  return !(await customerHasOpenComanda(tenantId, customerId))
}

// What removing this customer will affect — shown in the confirm dialog (AC-07/
// AC-10: "the team sees what will be cancelled") AND consumed by `deleteCustomer`
// to decide cascade vs hard-delete. All within-tenant reads (ADR 0004).
export type CustomerDeletionImpact = {
  // OPEN comandas — the blocker. Non-zero → deletion refused until resolved.
  openComandas: number
  // Active subscription the cascade will cancel (name + period end for the
  // "vence em DD/MM" copy). null when none.
  activeSubscription: { planName: string; periodEndAt: string } | null
  // Future scheduled appointments the cascade will cancel.
  futureAppointments: number
  // Whether the customer has ANY footprint (order / appointment / subscription,
  // any status). With footprint → soft-archive (keep the name in history);
  // without → hard-delete (nothing to orphan).
  hasFootprint: boolean
}

export async function getCustomerDeletionImpact(
  tenantId: string,
  customerId: string,
): Promise<CustomerDeletionImpact> {
  const tenant = tenantRef(tenantId)

  const orders = await tenant
    .collection('orders')
    .where('customerId', '==', customerId)
    .withConverter(fsConverter(OrderStatusProbe))
    .get()
  const openComandas = orders.docs.map((d) => d.data()).filter((o) => o.status === 'open').length

  const subsSnap = await tenant
    .collection('subscriptions')
    .where('customerId', '==', customerId)
    .withConverter(fsConverter(Subscription))
    .get()
  const activeSub = subsSnap.docs
    .map((d) => d.data())
    .find((s) => isActiveSubscriptionStatus(s.status))
  const activeSubscription = activeSub
    ? { planName: activeSub.plan.name, periodEndAt: activeSub.currentPeriod.endAt }
    : null

  const futureAppts = await tenant
    .collection('appointments')
    .where('customerId', '==', customerId)
    .where('status', '==', 'scheduled')
    .withConverter(fsConverter(ApptProbe))
    .get()
  const futureAppointments = futureAppts.docs
    .map((d) => d.data())
    .filter((data) => isFutureScheduledAppointment(data)).length

  // Footprint = any order/subscription/appointment (any status). Orders/subs
  // already establish it cheaply; only probe appointments when neither did.
  let hasFootprint = !orders.empty || !subsSnap.empty || futureAppts.size > 0
  if (!hasFootprint) {
    const anyAppt = await tenant
      .collection('appointments')
      .where('customerId', '==', customerId)
      .limit(1)
      .get()
    hasFootprint = !anyAppt.empty
  }

  return { openComandas, activeSubscription, futureAppointments, hasFootprint }
}
