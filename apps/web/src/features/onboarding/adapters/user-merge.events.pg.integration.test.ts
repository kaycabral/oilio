// Integration test for `mergeStubUserIntoClaimer` (#839, cutover #1202) against
// REAL Postgres — no mocks. Proves the identity-merge re-points every FK that
// referenced a STUB user (customer.userId, membership, appointment.customerUserId)
// to the claimer through DOMAIN EVENTS (never a raw projection UPDATE) and drops
// the stub `users` row, preserving the drop-vs-repoint conflict semantics and the
// counts + orgsTouched contract.
//
// The stub's orgs are enumerated WITHOUT a cross-org query (ADR 0004): the
// per-subject `org_links` reverse index (customers + appointments) + the stub's
// own `memberships`. Seeds therefore `linkCustomerOrg` every customer/appointment
// org so the enumeration finds it — exactly what `upsertCustomerWithUser` does in
// production.
//
// globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
// database (docker locally, services:postgres in CI). The local/CI role is
// superuser, so reads bypass RLS — the policies are proven separately by
// `rls-isolation`. We seed/read via the event store + the typed projection tables.

import { membershipDocId } from '@/domain'
import { AppointmentConfig, CustomerConfig, MembershipConfig } from '@/domain/aggregates'
import { appendEvent } from '@/domain/effect'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import {
  buildAppointment,
  buildMembership,
  buildStoredCustomer,
  buildUser,
} from '@/shared/fixtures/domain-builders'
import { linkCustomerOrg } from '@/shared/identity/org-links'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mergeStubUserIntoClaimer } from './user-merge'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

// The `customers`/`appointments` tables FK their `org_id` to `orgs` — seed the
// parent org row (raw INSERT, mirroring the config-projection pg test) so the
// projection writes don't trip `customers_org_id_fk`.
async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1, $2, $2, 1, 'Org', $3, 'barbershop', 'owner', '{}'::jsonb, $4, $4)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}`, orgId, `slug-${orgId}`, TS],
  )
}

async function seedStubUser(stubUid: string): Promise<void> {
  await putUser(buildUser(stubUid, TS, { displayName: 'Stub Customer' }))
}

async function seedClaimerUser(claimerUid: string): Promise<void> {
  await putUser(
    buildUser(claimerUid, TS, {
      email: 'claimer@example.com',
      displayName: 'Claimer',
      emailVerified: true,
      claimedAt: TS,
    }),
  )
}

// Each `seed*` appends a `*.created` event through the event store (sets the org
// GUC + projects in the same tx, like production), with the concrete aggregate
// config + typed payload so the event input stays type-safe.
async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  await seedOrg(orgId)
  await Effect.runPromise(
    appendEvent(CustomerConfig, `orgs/${orgId}/customers/${customerId}`, {
      _tag: 'customer.created',
      actorId: 'seed',
      payload: { data: buildStoredCustomer(customerId, orgId, userId, TS) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  // The reverse index is written as a saga step on customer creation in prod.
  await linkCustomerOrg(userId, orgId)
}

// Parent rows the new D2/0068 cross-aggregate FKs require. memberships.org_id →
// orgs; appointments reference unit/professional/service (the `buildAppointment`
// fixture defaults — 'unit'/'pro'/'svc'). buildMembership leaves rls_unit_scope
// null, so no unit FK there.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ('orgs/'||$1||'/units/'||$2,$1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, unitId, TS],
  )
}

async function seedProfessional(orgId: string, professionalId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO professionals (aggregate_path, org_id, id, version, user_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ('orgs/'||$1||'/professionals/'||$2,$1,$2,1,'user-'||$2,NULL,'[]'::jsonb,'[]'::jsonb,$3,$3)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, professionalId, TS],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (aggregate_path, org_id, id, version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ('orgs/'||$1||'/catalog_items/'||$2,$1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [orgId, serviceId, TS],
  )
}

async function seedMembership(orgId: string, userId: string): Promise<void> {
  await seedOrg(orgId)
  await Effect.runPromise(
    appendEvent(MembershipConfig, `memberships/${membershipDocId(orgId, userId)}`, {
      _tag: 'membership.created',
      actorId: 'seed',
      payload: { data: buildMembership(orgId, userId, TS, { role: 'receptionist' }) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function seedAppointment(
  orgId: string,
  apptId: string,
  customerId: string,
  customerUserId: string,
): Promise<void> {
  await seedOrg(orgId)
  // The appointment fixture defaults reference these parents.
  await seedUnit(orgId, 'unit')
  await seedProfessional(orgId, 'pro')
  await seedService(orgId, 'svc')
  await Effect.runPromise(
    appendEvent(AppointmentConfig, `orgs/${orgId}/appointments/${apptId}`, {
      _tag: 'appointment.created',
      actorId: 'seed',
      payload: { data: buildAppointment(apptId, orgId, TS, { customerId, customerUserId }) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  // A booked appointment always implies a customer in the org → its org_link.
  await linkCustomerOrg(customerUserId, orgId)
}

async function customerUserIdOf(orgId: string, customerId: string): Promise<string | null> {
  const res = await getEventStorePool().query<{ user_id: string }>(
    'SELECT user_id FROM customers WHERE aggregate_path = $1',
    [`orgs/${orgId}/customers/${customerId}`],
  )
  return res.rows[0]?.user_id ?? null
}

async function appointmentCustomerUserIdOf(orgId: string, apptId: string): Promise<string | null> {
  const res = await getEventStorePool().query<{ customer_user_id: string }>(
    'SELECT customer_user_id FROM appointments WHERE aggregate_path = $1',
    [`orgs/${orgId}/appointments/${apptId}`],
  )
  return res.rows[0]?.customer_user_id ?? null
}

async function membershipExists(orgId: string, userId: string): Promise<boolean> {
  const res = await getEventStorePool().query<{ n: number }>(
    'SELECT count(*)::int AS n FROM memberships WHERE aggregate_path = $1',
    [`memberships/${membershipDocId(orgId, userId)}`],
  )
  return (res.rows[0]?.n ?? 0) > 0
}

async function userExists(theUid: string): Promise<boolean> {
  const res = await getEventStorePool().query<{ n: number }>(
    'SELECT count(*)::int AS n FROM users WHERE uid = $1',
    [theUid],
  )
  return (res.rows[0]?.n ?? 0) > 0
}

// Wipe every table the merge touches so cases stay independent (parallel-safe via
// per-run-unique ids would also work, but a full wipe keeps assertions simple).
beforeEach(async () => {
  const pool = getEventStorePool()
  // TRUNCATE … CASCADE wipes referencing rows too (e.g. notifications → orgs FK),
  // so the cleanup is robust to whatever a prior test file left behind — a plain
  // ordered DELETE broke once another suite seeded a notification before this one.
  await pool.query(
    'TRUNCATE customers, appointments, memberships, org_links, orgs, users, events, projections, notifications, units, professionals, catalog_items CASCADE',
  )
})

afterAll(async () => {
  await closeEventStoreDb()
})

describe('mergeStubUserIntoClaimer (Postgres)', () => {
  it('re-points a single Customer and deletes the stub User row', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedCustomer(orgA, 'cust-1', stub)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.customersRepointed).toBe(1)
    expect(result.customersDropped).toBe(0)
    expect(result.orgsTouched).toEqual([orgA])
    expect(await customerUserIdOf(orgA, 'cust-1')).toBe(claimer)
    expect(await userExists(stub)).toBe(false)
  })

  it('re-points Customers across multiple orgs', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    const orgB = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedCustomer(orgA, 'cust-A', stub)
    await seedCustomer(orgB, 'cust-B', stub)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.customersRepointed).toBe(2)
    expect(result.orgsTouched.sort()).toEqual([orgA, orgB].sort())
  })

  it('drops the stub Customer when claimer already has one in the same org', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedCustomer(orgA, 'stub-cust', stub)
    await seedCustomer(orgA, 'claimer-cust', claimer)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.customersRepointed).toBe(0)
    expect(result.customersDropped).toBe(1)
    expect(await customerUserIdOf(orgA, 'stub-cust')).toBeNull()
    expect(await customerUserIdOf(orgA, 'claimer-cust')).toBe(claimer)
  })

  it('re-points Memberships by recreating at the claimer doc id', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedMembership(orgA, stub)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.membershipsRepointed).toBe(1)
    expect(await membershipExists(orgA, stub)).toBe(false)
    expect(await membershipExists(orgA, claimer)).toBe(true)
  })

  it('drops the stub Membership when the claimer already has one in the same org', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedMembership(orgA, stub)
    await seedMembership(orgA, claimer)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.membershipsRepointed).toBe(0)
    expect(result.membershipsDropped).toBe(1)
    expect(await membershipExists(orgA, stub)).toBe(false)
    expect(await membershipExists(orgA, claimer)).toBe(true)
  })

  it('re-points customerUserId on Appointments', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    const orgA = uid('org')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)
    await seedCustomer(orgA, 'cust-1', stub)
    await seedAppointment(orgA, 'appt-1', 'cust-1', stub)
    await seedAppointment(orgA, 'appt-2', 'cust-1', stub)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.appointmentsRepointed).toBe(2)
    expect(await appointmentCustomerUserIdOf(orgA, 'appt-1')).toBe(claimer)
    expect(await appointmentCustomerUserIdOf(orgA, 'appt-2')).toBe(claimer)
  })

  it('is a no-op when stub and claimer are the same uid', async () => {
    const same = uid('same')
    await seedClaimerUser(same)

    const result = await mergeStubUserIntoClaimer({ stubUid: same, claimerUid: same })

    expect(result).toEqual({
      customersRepointed: 0,
      customersDropped: 0,
      membershipsRepointed: 0,
      membershipsDropped: 0,
      appointmentsRepointed: 0,
      orgsTouched: [],
    })
    expect(await userExists(same)).toBe(true)
  })

  it('does nothing but delete the stub when it has no references', async () => {
    const stub = uid('stub')
    const claimer = uid('claimer')
    await seedStubUser(stub)
    await seedClaimerUser(claimer)

    const result = await mergeStubUserIntoClaimer({ stubUid: stub, claimerUid: claimer })

    expect(result.customersRepointed).toBe(0)
    expect(result.membershipsRepointed).toBe(0)
    expect(result.appointmentsRepointed).toBe(0)
    expect(result.orgsTouched).toEqual([])
    expect(await userExists(stub)).toBe(false)
  })
})
