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
// Query discipline (ADR 0004): every read is org-scoped under RLS
// (`readUnderRls`) — never a cross-org reach on operational data. We filter by
// `status = 'scheduled'` in SQL then drop past-dated slots in memory via the
// shared predicate (the customer footprint per org is small).

import {
  Appointment,
  Subscription,
  isActiveMembershipStatus,
  isActiveSubscriptionStatus,
  isFutureScheduledAppointment,
} from '@/domain'
import {
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getMembership } from '@/shared/org/membership'
import { countProfessionalsWithUnit, getProfessionalUserId } from '@/shared/org/professional-read'
import { Schema } from 'effect'

const decodeAppointment = Schema.decodeUnknownSync(Appointment)
const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// Reads the org's `scheduled` appointments for the given FK (`professional_id`
// / `customer_id`) under RLS, decoded to the domain `Appointment`. The
// caller applies `isFutureScheduledAppointment` to drop past-dated slots.
async function readScheduledAppointments(
  orgId: string,
  column: 'professional_id' | 'customer_id' | 'unit_id',
  id: string,
): Promise<Appointment[]> {
  const rows = await readUnderRls<AppointmentRow>(orgId, (client) =>
    client
      .query<AppointmentRow>(
        `SELECT * FROM appointments WHERE org_id = $1 AND ${column} = $2 AND status = 'scheduled'`,
        [orgId, id],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeAppointment(appointmentRowToDoc(row)))
}

// Reads the org's subscriptions (any status) for an optional customer filter,
// decoded to the domain `Subscription`. `where` is appended verbatim with the
// bound params the caller supplies.
async function readSubscriptions(
  orgId: string,
  where: string,
  params: readonly unknown[],
): Promise<Subscription[]> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE org_id = $1${where}`, [
        orgId,
        ...params,
      ])
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeSubscription(subscriptionRowToDoc(row)))
}

// Future-scheduled appointment probe shared by the professional and customer
// guards: both denormalize the FK directly on the appointment row
// (`professional_id` / `customer_id`), so we filter by `scheduled` in the query
// then drop past-dated slots in memory via the shared predicate. Completed /
// cancelled / no-show and past `scheduled` slots are historical (the
// appointment snapshotted price/duration/commission), so they never block.
async function hasFutureScheduledAppointment(
  orgId: string,
  field: 'professional_id' | 'customer_id',
  id: string,
): Promise<boolean> {
  const appts = await readScheduledAppointments(orgId, field, id)
  return appts.some((data) => isFutureScheduledAppointment(data))
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
export async function planHasActiveReference(orgId: string, planId: string): Promise<boolean> {
  // `plan` is a JSONB snapshot; filter by its frozen `planId` in SQL, then apply
  // the domain status predicate (a cancelled subscription keeps the plan
  // resolvable via its own snapshot and does not block).
  const subs = await readSubscriptions(orgId, ` AND plan->>'planId' = $2`, [planId])
  return subs.some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeletePlan(orgId: string, planId: string): Promise<boolean> {
  return !(await planHasActiveReference(orgId, planId))
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
  orgId: string,
  catalogItemId: string,
): Promise<boolean> {
  // (a) Open orders referencing the item in any line. `items` is a JSONB array
  // of objects; the existence probe matches any element whose `refId` equals the
  // item (`@>` containment), scoped to open orders. Only existence matters.
  const openRows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM orders
           WHERE org_id = $1 AND status = 'open' AND items @> $2::jsonb LIMIT 1`,
        [orgId, JSON.stringify([{ refId: catalogItemId }])],
      )
      .then((res) => res.rows),
  )
  if (openRows.length > 0) return true

  // (b) Active subscriptions whose frozen `plan.includedItemIds` snapshot covers
  // the item. Filter by JSONB containment in SQL, then apply the domain status
  // predicate (only an active subscriber's frozen coverage blocks).
  const covering = await readSubscriptions(orgId, ` AND plan->'includedItemIds' @> $2::jsonb`, [
    JSON.stringify([catalogItemId]),
  ])
  return covering.some((s) => isActiveSubscriptionStatus(s.status))
}

export async function canDeleteCatalogItem(orgId: string, catalogItemId: string): Promise<boolean> {
  return !(await catalogItemHasActiveReference(orgId, catalogItemId))
}

// ── Unit ───────────────────────────────────────────────────────────────────
// Active reference = a FUTURE scheduled appointment in the unit, OR a
// professional currently scoped to it (lifecycle/offboarding is non-destructive
// elsewhere — an active pro in the unit is a live dependency). Past/completed/
// cancelled appointments are historical (snapshotted) and do not block. Catalog
// items offered in the unit are editable config (the owner repoints `unitIds`),
// so they no longer block on their own.
export async function unitHasActiveReference(orgId: string, unitId: string): Promise<boolean> {
  // Professional actively scoped to the unit → live dependency. Existence check
  // (count over the `professional_units` join under RLS, brief 0068 D3) — only the
  // count matters, no decode/enrich.
  if ((await countProfessionalsWithUnit(orgId, unitId)) > 0) return true

  // Future scheduled appointment in the unit. Filter by `scheduled` status in
  // the query, then drop past-dated ones in memory via the shared predicate.
  const appts = await readScheduledAppointments(orgId, 'unit_id', unitId)
  return appts.some((data) => isFutureScheduledAppointment(data))
}

export async function canDeleteUnit(orgId: string, unitId: string): Promise<boolean> {
  return !(await unitHasActiveReference(orgId, unitId))
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
  orgId: string,
  professionalId: string,
): Promise<boolean> {
  if (await hasFutureScheduledAppointment(orgId, 'professional_id', professionalId)) return true

  // Reads the linked `userId` under RLS; use the tolerant `getProfessionalUserId`
  // (not the strict-decoding `getProfessionalById`) so a degenerate projection
  // doc doesn't throw on this fail-safe guard.
  const userId = await getProfessionalUserId(orgId, professionalId)
  if (!userId) return false

  const member = await getMembership(orgId, userId)
  return member ? isActiveMembershipStatus(member.status) : false
}

export async function canDeleteProfessional(
  orgId: string,
  professionalId: string,
): Promise<boolean> {
  return !(await professionalHasActiveReference(orgId, professionalId))
}

// ── Customer (operator delete — brief 0033, AC-07) ───────────────────────────
// Operator "Excluir cliente" is operational cleanup, NOT the LGPD erasure (brief
// 0032 — subject-only, self-service, identifiable name preserved here). The ONLY
// hard blocker is an OPEN comanda: a fiscal document in progress must not be
// orphaned by removing the customer (mapa Ciclo de Vida e Exclusão — the single
// rule shared with the LGPD block AC-11e and professional offboarding 0041).
//
// An active subscription + future appointments do NOT block — they are
// cascade-cancelled (`eraseCustomerCascadeInOrg`) and listed in the confirm
// dialog (AC-10) so the operator sees the impact first. The deletion itself then
// chooses hard-delete (no footprint) vs cascade + soft-archive (`deactivatedAt`,
// name kept) — see `deleteCustomer`. `customerId` is the per-org shadow id.
export async function customerHasOpenComanda(orgId: string, customerId: string): Promise<boolean> {
  const rows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM orders
           WHERE org_id = $1 AND customer_id = $2 AND status = 'open' LIMIT 1`,
        [orgId, customerId],
      )
      .then((res) => res.rows),
  )
  return rows.length > 0
}

export async function canDeleteCustomer(orgId: string, customerId: string): Promise<boolean> {
  return !(await customerHasOpenComanda(orgId, customerId))
}

// What removing this customer will affect — shown in the confirm dialog (AC-07/
// AC-10: "the team sees what will be cancelled") AND consumed by `deleteCustomer`
// to decide cascade vs hard-delete. All within-org reads (ADR 0004).
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
  orgId: string,
  customerId: string,
): Promise<CustomerDeletionImpact> {
  // Orders for the customer (any status) — `status` is enough to count open
  // comandas and establish footprint, so only that column is read.
  const orderStatuses = await readUnderRls<{ status: string }>(orgId, (client) =>
    client
      .query<{
        status: string
      }>('SELECT status FROM orders WHERE org_id = $1 AND customer_id = $2', [orgId, customerId])
      .then((res) => res.rows),
  )
  const openComandas = orderStatuses.filter((o) => o.status === 'open').length

  const subs = await readSubscriptions(orgId, ` AND customer_id = $2`, [customerId])
  const activeSub = subs.find((s) => isActiveSubscriptionStatus(s.status))
  const activeSubscription = activeSub
    ? { planName: activeSub.plan.name, periodEndAt: activeSub.currentPeriod.endAt }
    : null

  const scheduledAppts = await readScheduledAppointments(orgId, 'customer_id', customerId)
  const futureAppointments = scheduledAppts.filter((data) =>
    isFutureScheduledAppointment(data),
  ).length

  // Footprint = any order/subscription/appointment (any status). Orders/subs
  // already establish it cheaply; only probe appointments when neither did.
  let hasFootprint = orderStatuses.length > 0 || subs.length > 0 || scheduledAppts.length > 0
  if (!hasFootprint) {
    const anyAppt = await readUnderRls<{ one: number }>(orgId, (client) =>
      client
        .query<{
          one: number
        }>('SELECT 1 AS one FROM appointments WHERE org_id = $1 AND customer_id = $2 LIMIT 1', [
          orgId,
          customerId,
        ])
        .then((res) => res.rows),
    )
    hasFootprint = anyAppt.length > 0
  }

  return { openComandas, activeSubscription, futureAppointments, hasFootprint }
}
