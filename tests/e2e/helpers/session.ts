import { createIdentity } from '@/shared/auth/identity-provisioning'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appBaseUrl, e2eSupabase } from './app-env'

let cachedAdmin: SupabaseClient | undefined
function authAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin
  const { apiUrl, secretKey } = e2eSupabase()
  cachedAdmin = createClient(apiUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdmin
}

export async function createE2EIdentity(email: string, password: string): Promise<string> {
  const { uid } = await createIdentity(authAdmin(), { email, password })
  return uid
}

export type SeedOrgInput = {
  slotMinutes?: 5 | 10 | 15 | 30
  hasBusinessHours?: boolean
  unitCount?: number
  memberOperationCount?: number
  memberOperationOperationalStatus?: 'incomplete' | 'operational'
  vertical?: 'barbershop' | 'auto_wash' | 'auto_detailing' | 'other'
  cancellationPolicy?: { enabled: boolean; minNoticeMinutes: number }
  tier?: 'free' | 'pro' | 'advanced'
}

export type SeededOrg = {
  uid: string
  email: string
  password: string
  orgId: string
  unitIds: string[]
  memberOperationIds: string[]
}

import {
  Appointment as AppointmentSchema,
  CatalogItem as CatalogItemSchema,
  defaultPermissionsForRole,
  EMPTY_BUSINESS_HOURS,
  goalDocId,
  membershipDocId,
  Membership as MembershipSchema,
  Role as RoleSchema,
  StoredMemberOperation as StoredMemberOperationSchema,
  Subscription as SubscriptionSchema,
  type AgendaBlock,
  type AllowedTimeScope,
  type Appointment,
  type BookingLimits,
  type BusinessHours,
  type CatalogItem,
  type CatalogProductItem,
  type CatalogServiceItem,
  type Category,
  type Charge,
  type Commission,
  type Goal,
  type InvitePii,
  type MemberOperationPii,
  type Membership,
  type MembershipPermissions,
  type Order,
  type OrderCoverage,
  type OrderItem,
  type Role,
  type StoredCustomer,
  type StoredInvite,
  type StoredMemberOperation,
  type StoredOrg,
  type StoredUnit,
  type Subscription,
  type SubscriptionPeriod,
  type SubscriptionPlan,
  type SubscriptionPlanSnapshot,
  type SubscriptionStatus,
  type UnitPii,
  type User,
} from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CatalogItemConfig,
  CategoryConfig,
  ChargeConfig,
  CommissionConfig,
  CustomerConfig,
  deriveOperationalStatus,
  GoalConfig,
  InviteConfig,
  MemberOperationConfig,
  MembershipConfig,
  OrderConfig,
  OrgConfig,
  SubscriptionConfig,
  SubscriptionPlanConfig,
  UnitConfig,
} from '@/domain/aggregates'
import { aggregateRef, type AggregateRef } from '@/domain/effect'
import {
  AGENDA_BLOCK_COLUMNS,
  agendaBlockColumnValues,
} from '@/shared/db/pg/effect/agenda-block-projector'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
  rowToDoc as appointmentRowToDoc,
  type AppointmentRow,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  CATALOG_ITEM_COLUMNS,
  catalogItemColumnValues,
  rowToDoc as catalogItemRowToDoc,
  type CatalogItemRow,
} from '@/shared/db/pg/effect/catalog-item-projector'
import { CATEGORY_COLUMNS, categoryColumnValues } from '@/shared/db/pg/effect/category-projector'
import { CHARGE_COLUMNS, chargeColumnValues } from '@/shared/db/pg/effect/charge-projector'
import {
  COMMISSION_COLUMNS,
  commissionColumnValues,
} from '@/shared/db/pg/effect/commission-projector'
import { CUSTOMER_COLUMNS, customerColumnValues } from '@/shared/db/pg/effect/customer-projector'
import { GOAL_COLUMNS, goalColumnValues } from '@/shared/db/pg/effect/goal-projector'
import {
  INVITE_COLUMNS,
  inviteColumnValues,
  type InviteRow,
} from '@/shared/db/pg/effect/invite-projector'
import {
  MEMBER_OPERATION_COLUMNS,
  MEMBER_OPERATION_SERVICES_DELETE,
  MEMBER_OPERATION_SERVICES_INSERT,
  MEMBER_OPERATION_UNITS_INSERT,
  memberOperationColumnValues,
  rowToDoc as memberOperationRowToDoc,
  memberOperationServiceRows,
  memberOperationUnitRows,
  type MemberOperationRow,
} from '@/shared/db/pg/effect/member-operation-projector'
import {
  MEMBERSHIP_COLUMNS,
  membershipColumnValues,
  rowToDoc as membershipRowToDoc,
  type MembershipRow,
} from '@/shared/db/pg/effect/membership-projector'
import { ORDER_COLUMNS, orderColumnValues } from '@/shared/db/pg/effect/order-projector'
import {
  ORG_COLUMNS,
  orgColumnValues,
  PUBLIC_DIRECTORY_UPSERT,
  publicOrgDirectoryValues,
} from '@/shared/db/pg/effect/org-projector'
import {
  SUBSCRIPTION_PLAN_COLUMNS,
  subscriptionPlanColumnValues,
} from '@/shared/db/pg/effect/subscription-plan-projector'
import {
  SUBSCRIPTION_COLUMNS,
  subscriptionColumnValues,
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { UNIT_COLUMNS, unitColumnValues } from '@/shared/db/pg/effect/unit-projector'
import { upsertInvitePii, upsertMemberOperationPii } from '@/shared/db/pg/pii-sidecars-store'
import { upsertUnitsPii } from '@/shared/db/pg/units-pii-store'
import { getUserById, putUser } from '@/shared/db/pg/users-store'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { buildAddress } from '@/shared/fixtures/seed-domain-builders'
import { Schema } from 'effect'
import { createHash, randomBytes } from 'node:crypto'

function uniqueSuffix() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

let whatsappCounter = 0
export function uniqueWhatsapp(): string {
  whatsappCounter += 1
  const rand = randomBytes(4).readUInt32BE(0)
  const subscriber = (rand + whatsappCounter) % 100_000_000
  return `55119${String(subscriber).padStart(8, '0')}`
}

export function uniqueNationalWhatsapp(): string {
  return uniqueWhatsapp().slice(2)
}

export async function seedGoal(
  orgId: string,
  unitId: string,
  period: string,
  targetCents: number,
): Promise<void> {
  const id = goalDocId('profit', unitId, period)
  const now = new Date().toISOString()
  const doc: Goal = {
    id,
    orgId,
    unitId,
    period,
    type: 'profit',
    targetCents,
    createdAt: now,
    updatedAt: now,
  }
  await seedGoalDoc(orgId, doc)
}

export async function seedOrg(input: SeedOrgInput = {}): Promise<SeededOrg> {
  const {
    slotMinutes = 15,
    hasBusinessHours = true,
    unitCount = 1,
    memberOperationCount = 1,
    memberOperationOperationalStatus = 'operational',
    vertical = 'barbershop',
    cancellationPolicy,
    tier = 'advanced',
  } = input

  const password = 'E2E12345!'
  const email = `e2e+${uniqueSuffix()}@example.com`

  const uid = await createE2EIdentity(email, password)

  const orgId = `e2e-org-${uniqueSuffix()}`
  const now = new Date().toISOString()

  const address: StoredUnit['address'] = buildAddress()

  const businessHours: BusinessHours = hasBusinessHours
    ? {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: null,
        sunday: null,
      }
    : EMPTY_BUSINESS_HOURS

  const orgDoc: StoredOrg = {
    id: orgId,
    name: `E2E ${orgId}`,
    slug: `e2e-${orgId}`.toLowerCase(),
    vertical,
    ownerUserId: uid,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: now,
    updatedAt: now,
  }
  await seedOrgDoc(orgId, orgDoc)

  if (tier !== 'free') {
    await seedOrgBilling(orgId, { tier, unitQuantity: unitCount })
  }

  const membershipId = `${orgId}_${uid}`
  const ownerMembership: Membership = {
    id: membershipId,
    orgId,
    userId: uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  await seedMembershipDoc(ownerMembership)

  await putUserDoc(
    buildUser(uid, now, {
      email,
      displayName: 'E2E Owner',
      emailVerified: true,
      currentOrgId: orgId,
      mobile: uniqueWhatsapp(),
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )

  const unitIds: string[] = []
  for (let i = 0; i < unitCount; i++) {
    const unitId = `e2e-unit-${uniqueSuffix()}`
    unitIds.push(unitId)
    const unitDoc: StoredUnit = {
      id: unitId,
      orgId,
      name: `Unidade ${i + 1}`,
      slug: `unidade-${i + 1}`,
      address,
      timezone: 'America/Sao_Paulo',
      agenda: {
        mode: 'appointment',
        businessHours,
        slotMinutes,
        cancellationPolicy: {
          enabled: cancellationPolicy?.enabled ?? false,
          minNoticeMinutes: cancellationPolicy?.minNoticeMinutes ?? 120,
        },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      },
      archivedAt: null,
      fiscal: { kind: 'informal' },
      createdAt: now,
      updatedAt: now,
    }
    await seedUnitDoc(orgId, unitId, unitDoc)
    const unitPii: UnitPii = { mobile: '5511900000000', email: null }
    await upsertUnitsPii(orgId, unitId, unitPii)
  }

  const operationalServiceId =
    memberOperationCount > 0 && memberOperationOperationalStatus !== 'incomplete'
      ? await seedService(orgId, {
          name: 'Serviço base',
          durationMinutes: 30,
          priceCents: 5000,
          publicVisible: true,
          unitIds: [...unitIds],
        })
      : null

  const memberOperationIds: string[] = []
  for (let i = 0; i < memberOperationCount; i++) {
    const pid = `e2e-prof-${uniqueSuffix()}`
    memberOperationIds.push(pid)
    const proUid = `e2e-prof-user-${pid}`
    const wantsOperational = memberOperationOperationalStatus !== 'incomplete'
    await putUserDoc(
      buildUser(proUid, now, {
        email: `prof-${i + 1}-${pid}@e2e.local`,
        displayName: `Profissional ${i + 1}`,
        emailVerified: true,
        currentOrgId: orgId,
        ...(wantsOperational ? { mobile: uniqueWhatsapp(), completionCompleted: true } : {}),
        claimedAt: now,
      }),
    )
    const proDoc: StoredMemberOperation = {
      id: pid,
      orgId,
      userId: proUid,
      defaultCommission: null,
      unitIds: [...unitIds],
      catalogServiceIds: operationalServiceId ? [operationalServiceId] : [],
      createdAt: now,
      updatedAt: now,
    }
    const proMembershipId = `${orgId}_${proUid}`
    const proMembership: Membership = {
      id: proMembershipId,
      orgId,
      userId: proUid,
      role: 'member_operator',
      status: 'active',
      invitedBy: uid,
      joinedAt: now,
      updatedAt: now,
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('member_operator'),
    }
    await seedMembershipDoc(proMembership)
    await seedMemberOperationDoc(orgId, proDoc)
    const proPii: MemberOperationPii = { taxIdentity: null }
    await upsertMemberOperationPii({ orgId, id: pid, taxIdentity: proPii.taxIdentity })
  }

  return { uid, email, password, orgId, unitIds, memberOperationIds }
}

async function readMembershipRowById(membershipId: string): Promise<MembershipRow | null> {
  const rows = await pgQueryProjection('memberships', 'id', membershipId)
  const row = rows[0]
  return row ? Schema.decodeUnknownSync(MembershipRowSchema)(row) : null
}

async function readMembershipDoc(membershipId: string): Promise<Membership> {
  const row = await readMembershipRowById(membershipId)
  if (!row) throw new Error(`setMembership*: membership ${membershipId} not found`)
  return Schema.decodeUnknownSync(MembershipSchema)(membershipRowToDoc(row))
}

export async function setMembershipRole(membershipId: string, role: string): Promise<void> {
  const current = await readMembershipDoc(membershipId)
  const nextRole = Schema.decodeUnknownSync(RoleSchema)(role)
  const next: Membership = {
    ...current,
    role: nextRole,
    permissions: defaultPermissionsForRole(nextRole),
  }
  const ref = aggregateRef(MembershipConfig, next.orgId, membershipId)
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'membership.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBERSHIP_COLUMNS,
    valuesAt: (v) => membershipColumnValues(next, ref, v),
    table: 'memberships',
  })
}

export async function setSubscriptionStatus(
  orgId: string,
  subscriptionId: string,
  status: SubscriptionStatus,
): Promise<void> {
  const ref = aggregateRef(SubscriptionConfig, orgId, subscriptionId)
  const row = await readProjectionRow<SubscriptionRow>('subscriptions', ref)
  if (!row) throw new Error(`setSubscriptionStatus: subscription ${subscriptionId} not found`)
  const current = Schema.decodeUnknownSync(SubscriptionSchema)(subscriptionRowToDoc(row))
  const next: Subscription = { ...current, status }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'subscription.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: SUBSCRIPTION_COLUMNS,
    valuesAt: (v) => subscriptionColumnValues(next, v),
    table: 'subscriptions',
  })
}

export async function setMembershipUnitId(
  membershipId: string,
  unitId: string | null,
): Promise<void> {
  const current = await readMembershipDoc(membershipId)
  const next: Membership = { ...current, rlsUnitScope: unitId }
  const ref = aggregateRef(MembershipConfig, next.orgId, membershipId)
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'membership.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBERSHIP_COLUMNS,
    valuesAt: (v) => membershipColumnValues(next, ref, v),
    table: 'memberships',
  })
}

export async function seedMember(
  orgId: string,
  opts: {
    role: 'manager' | 'member_operator' | 'receptionist'
    displayName: string
    unitId?: string | null
  },
): Promise<{ userId: string }> {
  const userId = `e2e-member-${uniqueSuffix()}`
  const now = new Date().toISOString()
  await putUserDoc(
    buildUser(userId, now, {
      email: `${userId}@e2e.local`,
      displayName: opts.displayName,
      emailVerified: true,
      currentOrgId: orgId,
      mobile: uniqueWhatsapp(),
      completionCompleted: true,
      claimedAt: now,
    }),
  )
  const membershipId = `${orgId}_${userId}`
  const permissions: MembershipPermissions = {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageCatalog: false,
    canManageOperators: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
    canManageBilling: false,
    canBeBooked: false,
    canEarnCommission: false,
  }
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId,
    role: opts.role,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: opts.unitId ?? null,
    permissions,
  }
  await seedMembershipDoc(membership)
  return { userId }
}

export async function seedMembershipFor(
  orgId: string,
  userId: string,
  opts: { role: Role; unitId?: string | null },
): Promise<string> {
  const now = new Date().toISOString()
  const membershipId = membershipDocId(orgId, userId)
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId,
    role: opts.role,
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: opts.unitId ?? null,
    permissions: defaultPermissionsForRole(opts.role),
  }
  await seedMembershipDoc(membership)
  return membershipId
}

export async function seedLoginableMemberOperation(
  orgId: string,
  opts: { unitIds: string[]; catalogServiceIds?: string[]; displayName?: string },
): Promise<{ uid: string; email: string; password: string; memberOperationId: string }> {
  const auth = await seedAuthUser()
  const now = new Date().toISOString()
  const memberOperationId = `e2e-prof-${uniqueSuffix()}`

  await putUserDoc(
    buildUser(auth.uid, now, {
      email: auth.email,
      displayName: opts.displayName ?? 'E2E Profissional',
      emailVerified: true,
      currentOrgId: orgId,
      mobile: uniqueWhatsapp(),
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )

  const proDoc: StoredMemberOperation = {
    id: memberOperationId,
    orgId,
    userId: auth.uid,
    defaultCommission: null,
    unitIds: [...opts.unitIds],
    catalogServiceIds: [...(opts.catalogServiceIds ?? [])],
    createdAt: now,
    updatedAt: now,
  }
  const membership: Membership = {
    id: membershipDocId(orgId, auth.uid),
    orgId,
    userId: auth.uid,
    role: 'member_operator',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('member_operator'),
  }
  await seedMembershipDoc(membership)
  await seedMemberOperationDoc(orgId, proDoc)
  await upsertMemberOperationPii({ orgId, id: memberOperationId, taxIdentity: null })

  return { ...auth, memberOperationId }
}

export async function seedLoginableMemberWithoutProfile(
  orgId: string,
  opts: { displayName?: string } = {},
): Promise<{ uid: string; email: string; password: string }> {
  const auth = await seedAuthUser()
  const now = new Date().toISOString()
  await putUserDoc(
    buildUser(auth.uid, now, {
      email: auth.email,
      displayName: opts.displayName ?? 'E2E Sem Perfil',
      emailVerified: true,
      currentOrgId: orgId,
      mobile: uniqueWhatsapp(),
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )
  const membership: Membership = {
    id: membershipDocId(orgId, auth.uid),
    orgId,
    userId: auth.uid,
    role: 'member_operator',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('member_operator'),
  }
  await seedMembershipDoc(membership)
  return auth
}

export async function seedAdditionalOrg(
  uid: string,
  opts: { name?: string; unitCount?: number } = {},
): Promise<{ orgId: string; unitIds: string[] }> {
  const unitCount = opts.unitCount ?? 1
  const orgId = `e2e-org-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? `E2E ${orgId}`

  const orgDoc: StoredOrg = {
    id: orgId,
    name,
    slug: `e2e-${orgId}`.toLowerCase(),
    vertical: 'barbershop',
    ownerUserId: uid,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: now,
    updatedAt: now,
  }
  await seedOrgDoc(orgId, orgDoc)

  const membershipId = `${orgId}_${uid}`
  const membership: Membership = {
    id: membershipId,
    orgId,
    userId: uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: now,
    updatedAt: now,
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('owner'),
  }
  await seedMembershipDoc(membership)

  const unitIds: string[] = []
  for (let i = 0; i < unitCount; i++) {
    const unitId = `e2e-unit-${uniqueSuffix()}`
    unitIds.push(unitId)
    const unitDoc: StoredUnit = {
      id: unitId,
      orgId,
      name: `${name} Unidade ${i + 1}`,
      slug: `unidade-${i + 1}`,
      address: buildAddress(),
      timezone: 'America/Sao_Paulo',
      agenda: {
        mode: 'appointment',
        businessHours: EMPTY_BUSINESS_HOURS,
        slotMinutes: 15,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      },
      archivedAt: null,
      fiscal: { kind: 'informal' },
      createdAt: now,
      updatedAt: now,
    }
    await seedUnitDoc(orgId, unitId, unitDoc)
    const unitPii: UnitPii = { mobile: '5511900000000', email: null }
    await upsertUnitsPii(orgId, unitId, unitPii)
  }

  return { orgId, unitIds }
}

export type SeedAppointmentInput = {
  orgId: string
  unitId: string
  memberOperationId: string
  customerId: string
  serviceId: string
  startAt: string
  endAt: string
  status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  servicePriceCentsSnapshot?: number
  serviceDurationMinutesSnapshot?: number
  commissionSnapshot?: { kind: 'percentage' | 'fixed'; value: number } | null
  cancellationPolicySnapshot?: { enabled: boolean; minNoticeMinutes: number } | null
}

async function readCustomerUserId(orgId: string, customerId: string): Promise<string> {
  const row = await pgReadProjection('customers', aggregateRef(CustomerConfig, orgId, customerId))
  const uid = row?.user_id
  if (typeof uid !== 'string' || !uid) {
    throw new Error(`seedAppointment: customer ${customerId} has no userId`)
  }
  return uid
}

async function firstUnitIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('units', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstUnitIdForOrg: org ${orgId} has no unit projection`)
  }
  return id
}

async function firstSubscriptionIdForOrg(orgId: string, unitId?: string): Promise<string> {
  const rows = await pgQueryProjection('subscriptions', 'org_id', orgId)
  const row = unitId ? (rows.find((r) => r.unit_id === unitId) ?? rows[0]) : rows[0]
  const id = row?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(
      `firstSubscriptionIdForOrg: org ${orgId}${unitId ? ` unit ${unitId}` : ''} has no subscription projection`,
    )
  }
  return id
}

async function firstCustomerIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('customers', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstCustomerIdForOrg: org ${orgId} has no customer projection`)
  }
  return id
}

async function firstOrderIdForOrg(orgId: string): Promise<string> {
  const rows = await pgQueryProjection('orders', 'org_id', orgId)
  const id = rows[0]?.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`firstOrderIdForOrg: org ${orgId} has no order projection`)
  }
  return id
}

async function readMemberOperationUserId(
  orgId: string,
  memberOperationId: string,
): Promise<string | null> {
  const row = await pgReadProjection(
    'member_operations',
    aggregateRef(MemberOperationConfig, orgId, memberOperationId),
  )
  const uid = row?.user_id
  return typeof uid === 'string' && uid ? uid : null
}

const TimestamptzRowCell = Schema.transform(
  Schema.Union(Schema.String, Schema.DateFromSelf),
  Schema.String,
  {
    strict: true,
    decode: (value) => (value instanceof Date ? value.toISOString() : value),
    encode: (value) => value,
  },
)

const MemberOperationRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  last_event_version: Schema.Union(Schema.String, Schema.Number),
  user_id: Schema.String,
  member_id: Schema.String,
  default_commission: Schema.Unknown,
  unit_ids: Schema.Unknown,
  catalog_service_ids: Schema.Unknown,
  created_at: TimestamptzRowCell,
  updated_at: TimestamptzRowCell,
})

const MembershipRowSchema = Schema.Struct({
  org_id: Schema.String,
  id: Schema.String,
  user_id: Schema.String,
  last_event_version: Schema.Union(Schema.String, Schema.Number),
  role: Schema.String,
  status: Schema.String,
  rls_unit_scope: Schema.Union(Schema.String, Schema.Null),
  invited_by: Schema.Union(Schema.String, Schema.Null),
  joined_at: TimestamptzRowCell,
  permissions: Schema.Unknown,
  updated_at: TimestamptzRowCell,
})

export type ReadMemberOperationResult = { id: string; operationalStatus: string }

export async function readMemberOperationByUserId(
  orgId: string,
  userId: string,
): Promise<ReadMemberOperationResult | null> {
  const rows = await pgQueryProjection('member_operations', 'user_id', userId)
  const row = rows.find((r) => r.org_id === orgId) ?? null
  if (!row) return null
  const typedRow = Schema.decodeUnknownSync(MemberOperationRowSchema)(row)
  const stored = Schema.decodeUnknownSync(StoredMemberOperationSchema)(
    memberOperationRowToDoc(typedRow),
  )
  const user = await readUser(stored.userId)
  const mobile = user && 'mobile' in user && typeof user.mobile === 'string' ? user.mobile : null
  const operationalStatus = deriveOperationalStatus({
    inviteAccepted: true,
    mobile,
    unitIds: stored.unitIds,
    catalogServiceIds: stored.catalogServiceIds,
  })
  return { id: stored.id, operationalStatus }
}

async function ensureMemberOperationExists(
  orgId: string,
  memberOperationId: string,
): Promise<void> {
  if (
    await pgProjectionExists(
      'member_operations',
      aggregateRef(MemberOperationConfig, orgId, memberOperationId),
    )
  )
    return
  const now = new Date().toISOString()
  const proUid = `e2e-prof-user-${memberOperationId}`
  const membershipId = membershipDocId(orgId, proUid)
  if (
    !(await pgProjectionExists('memberships', aggregateRef(MembershipConfig, orgId, membershipId)))
  ) {
    await seedMembershipDoc({
      id: membershipId,
      orgId,
      userId: proUid,
      role: 'member_operator',
      status: 'active',
      invitedBy: null,
      joinedAt: now,
      updatedAt: now,
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('member_operator'),
    })
  }
  const doc: StoredMemberOperation = {
    id: memberOperationId,
    orgId,
    userId: proUid,
    defaultCommission: null,
    unitIds: [],
    catalogServiceIds: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedMemberOperationDoc(orgId, doc)
}

async function ensureServiceExists(orgId: string, serviceId: string): Promise<void> {
  if (await pgProjectionExists('catalog_items', aggregateRef(CatalogItemConfig, orgId, serviceId)))
    return
  const now = new Date().toISOString()
  const doc: CatalogServiceItem = {
    id: serviceId,
    orgId,
    kind: 'service',
    name: 'Corte',
    categoryId: null,
    priceCents: 5000,
    commission: null,
    unitIds: ['e2e-default-unit'],
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: 30,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, serviceId, doc)
}

export async function seedAppointment(input: SeedAppointmentInput): Promise<string> {
  const id = `e2e-appt-${uniqueSuffix()}`
  const now = new Date().toISOString()
  await ensureMemberOperationExists(input.orgId, input.memberOperationId)
  await ensureServiceExists(input.orgId, input.serviceId)
  const customerUserId = await readCustomerUserId(input.orgId, input.customerId)
  const memberOperatorUserId = await readMemberOperationUserId(input.orgId, input.memberOperationId)
  const doc: Appointment = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    memberOperationId: input.memberOperationId,
    customerId: input.customerId,
    serviceId: input.serviceId,
    startAt: input.startAt,
    endAt: input.endAt,
    status: input.status ?? 'scheduled',
    servicePriceCentsSnapshot: input.servicePriceCentsSnapshot ?? 5000,
    serviceDurationMinutesSnapshot: input.serviceDurationMinutesSnapshot ?? 30,
    commissionSnapshot: input.commissionSnapshot ?? null,
    cancellationPolicySnapshot: input.cancellationPolicySnapshot ?? null,
    customerUserId,
    memberOperatorUserId,
    attribution: null,
    createdAt: now,
    updatedAt: now,
  }
  const ref = aggregateRef(AppointmentConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'appointment.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: APPOINTMENT_COLUMNS,
    values: appointmentColumnValues(doc, ref, 1),
    table: 'appointments',
  })
  return id
}

export async function seedCustomer(
  orgId: string,
  opts: {
    name?: string
    mobile?: string | null
    email?: string | null
    document?: string | null
    userId?: string
    avatarUrl?: string | null
  } = {},
): Promise<string> {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const userId = opts.userId ?? `e2e-user-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? `Cliente ${customerId.slice(-4)}`

  await putUserDoc(
    buildUser(userId, now, {
      email: opts.email ?? null,
      displayName: name,
      avatarUrl: opts.avatarUrl ?? null,
      mobile: opts.mobile ?? null,
    }),
  )

  const customerDoc: StoredCustomer = buildStoredCustomer(customerId, orgId, userId, now)
  await seedCustomerDoc(orgId, customerDoc)
  await seedOrgLink(userId, orgId)
  return customerId
}

export async function seedCustomerShadowForUser(orgId: string, userId: string): Promise<string> {
  const customerId = `e2e-cust-${uniqueSuffix()}`
  const now = new Date().toISOString()
  await seedCustomerDoc(orgId, buildStoredCustomer(customerId, orgId, userId, now))
  await seedOrgLink(userId, orgId)
  return customerId
}

export async function blockedSubjectMarkerExists(orgId: string, userId: string): Promise<boolean> {
  const rows = await pgQueryProjection('customers', 'user_id', userId)
  return rows.some((r) => r.org_id === orgId && r.archived_at !== null)
}

export async function seedOrgLink(userId: string, orgId: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `INSERT INTO org_links (user_id, org_id, linked_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userId, orgId, new Date().toISOString()],
    )
  } finally {
    await client.end()
  }
}

export async function seedOrgBilling(
  orgId: string,
  opts: {
    tier: 'pro' | 'advanced'
    billingCycle?: 'monthly' | 'annual'
    unitQuantity?: number
  },
): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const now = new Date().toISOString()
    await client.query(
      `INSERT INTO org_billing
         (org_id, id, last_event_version, tier, status, billing_cycle, unit_quantity,
          stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end,
          created_at, updated_at)
       VALUES ($1, $1, 1, $2, 'active', $3, $4, $5, $6, $7, false, $8, $8)
       ON CONFLICT (org_id) DO UPDATE SET
         tier = EXCLUDED.tier, status = EXCLUDED.status, billing_cycle = EXCLUDED.billing_cycle,
         unit_quantity = EXCLUDED.unit_quantity, updated_at = EXCLUDED.updated_at`,
      [
        orgId,
        opts.tier,
        opts.billingCycle ?? 'monthly',
        opts.unitQuantity ?? 1,
        `cus_seed_${orgId}`,
        `sub_seed_${orgId}`,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        now,
      ],
    )
  } finally {
    await client.end()
  }
}

export async function readOrgLink(
  userId: string,
  orgId: string,
): Promise<{ orgId: string; linkedAt: string } | null> {
  const rows = await pgQueryProjection('org_links', 'user_id', userId)
  const row = rows.find((r) => r.org_id === orgId)
  if (!row) return null
  return { orgId: String(row.org_id), linkedAt: String(row.linked_at) }
}

function buildTimeScope(ts: {
  daysOfWeek?: number[]
  hourRange?: { start: string; end: string }
  advanceBookingDays?: number
}): AllowedTimeScope {
  const scope: AllowedTimeScope = {}
  if (ts.daysOfWeek) scope.daysOfWeek = [...ts.daysOfWeek]
  if (ts.hourRange) scope.hourRange = { start: ts.hourRange.start, end: ts.hourRange.end }
  if (typeof ts.advanceBookingDays === 'number') scope.advanceBookingDays = ts.advanceBookingDays
  return scope
}

function buildBookingLimits(limits: {
  maxPerDay?: number
  maxConcurrent?: number
  requireCompleteBeforeNext?: boolean
}): BookingLimits {
  const out: BookingLimits = {}
  if (limits.maxPerDay !== undefined) out.maxPerDay = limits.maxPerDay
  if (limits.maxConcurrent !== undefined) out.maxConcurrent = limits.maxConcurrent
  if (limits.requireCompleteBeforeNext !== undefined) {
    out.requireCompleteBeforeNext = limits.requireCompleteBeforeNext
  }
  return out
}

export async function seedSubscription(
  orgId: string,
  customerId: string,
  opts: {
    planName?: string
    priceCents?: number
    status?: SubscriptionStatus
    unitAllowlist?: string[]
    allowedTimeScope?: {
      daysOfWeek?: number[]
      hourRange?: { start: string; end: string }
      advanceBookingDays?: number
    }
    bookingLimits?: {
      maxPerDay?: number
      maxConcurrent?: number
      requireCompleteBeforeNext?: boolean
    }
    usageLimit?: { kind: 'unlimited' } | { kind: 'count'; quantity: number }
    consumed?: number
    includedCategoryIds?: string[]
    includedItemIds?: string[]
    planId?: string
    unitId?: string
  } = {},
): Promise<string> {
  const subId = `e2e-sub-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const startAt = new Date().toISOString()
  const endAt = new Date(Date.now() + 30 * 86400_000).toISOString()
  const planName = opts.planName ?? 'Plano Mensal Corte'
  const priceCents = opts.priceCents ?? 9000
  const status = opts.status ?? 'active'

  const customerUserId = await readCustomerUserId(orgId, customerId)
  const unitId = opts.unitId ?? (await firstUnitIdForOrg(orgId))

  const plan: SubscriptionPlanSnapshot = {
    planId: opts.planId ?? 'e2e-plan',
    name: planName,
    priceCents,
    billingCycle: 'monthly',
    includedItemIds: [...(opts.includedItemIds ?? [])],
    includedCategoryIds: [...(opts.includedCategoryIds ?? [])],
    usageLimit:
      opts.usageLimit && opts.usageLimit.kind === 'count'
        ? { kind: 'count', quantity: opts.usageLimit.quantity }
        : { kind: 'unlimited' },
  }
  if (opts.unitAllowlist) plan.unitAllowlist = [...opts.unitAllowlist]
  if (opts.allowedTimeScope) plan.allowedTimeScope = buildTimeScope(opts.allowedTimeScope)
  if (opts.bookingLimits) plan.bookingLimits = buildBookingLimits(opts.bookingLimits)

  const currentPeriod: SubscriptionPeriod = {
    startAt,
    endAt,
    consumed: opts.consumed ?? 0,
  }
  const doc: Subscription = {
    id: subId,
    orgId,
    unitId,
    customerId,
    customerUserId: customerUserId || null,
    plan,
    status,
    currentPeriod,
    cancelAtPeriodEnd: false,
    nextChargeDate: endAt,
    cancellationReason: null,
    cancelledAt: null,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    createdAt: now,
    updatedAt: now,
  }
  const ref = aggregateRef(SubscriptionConfig, orgId, subId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'subscription.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: SUBSCRIPTION_COLUMNS,
    values: subscriptionColumnValues(doc, 1),
    table: 'subscriptions',
  })
  return subId
}

export async function seedPaidCharge(
  orgId: string,
  opts: {
    unitId: string
    amountCents: number
    paidAt: string
    subscriptionId?: string
    customerId?: string
  },
): Promise<string> {
  const chargeId = `e2e-charge-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const subscriptionId =
    opts.subscriptionId ?? (await firstSubscriptionIdForOrg(orgId, opts.unitId))
  const customerId = opts.customerId ?? (await firstCustomerIdForOrg(orgId))
  const doc: Charge = {
    id: chargeId,
    orgId,
    unitId: opts.unitId,
    subscriptionId,
    customerId,
    amountCents: opts.amountCents,
    periodStartAt: opts.paidAt,
    periodEndAt: opts.paidAt,
    dueDate: opts.paidAt,
    status: 'paid',
    attempts: 1,
    paidAt: opts.paidAt,
    failedAt: null,
    failureReason: null,
    refundedAt: null,
    lastActorUid: null,
    createdAt: now,
    updatedAt: now,
  }
  const ref = aggregateRef(ChargeConfig, orgId, chargeId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'charge.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CHARGE_COLUMNS,
    values: chargeColumnValues(doc, ref, 1),
    table: 'charges',
  })
  return chargeId
}

export async function seedRazaoRevenue(
  orgId: string,
  opts: { unitId: string; amountCents: number; periodStartAt: string },
): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope, occurred_at)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [
        'charge',
        `e2e-razao-${uniqueSuffix()}`,
        orgId,
        {
          _tag: 'charge.succeeded',
          version: 1,
          timestamp: opts.periodStartAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: {
            changes: {
              status: 'paid',
              paidAt: opts.periodStartAt,
              attempts: 1,
              periodStartAt: opts.periodStartAt,
              amountCents: opts.amountCents,
              unitId: opts.unitId,
              updatedAt: opts.periodStartAt,
            },
          },
        },
        opts.periodStartAt,
      ],
    )
  } finally {
    await client.end()
  }
}

export async function seedService(
  orgId: string,
  opts: {
    name?: string
    category?: string | null
    durationMinutes?: number
    priceCents?: number
    commission?: { kind: 'percentage' | 'fixed'; value: number } | null
    publicVisible?: boolean
    priceVisibility?: 'visible' | 'on_request'
    unitIds?: string[]
    unitOverrides?: Record<string, { priceCents?: number; durationMinutes?: number }> | null
  } = {},
): Promise<string> {
  const id = `e2e-svc-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const commission = opts.commission ?? null
  const unitIds = opts.unitIds && opts.unitIds.length > 0 ? [...opts.unitIds] : ['e2e-default-unit']
  const unitOverrides: CatalogServiceItem['unitOverrides'] = opts.unitOverrides
    ? Object.fromEntries(
        Object.entries(opts.unitOverrides).map(([uid, o]) => {
          const inner: { priceCents?: number; durationMinutes?: number } = {}
          if (o.priceCents !== undefined) inner.priceCents = o.priceCents
          if (o.durationMinutes !== undefined) inner.durationMinutes = o.durationMinutes
          return [uid, inner]
        }),
      )
    : null

  const catalogDoc: CatalogServiceItem = {
    id,
    orgId,
    kind: 'service',
    name: opts.name ?? 'Corte',
    categoryId: opts.category ?? null,
    priceCents: opts.priceCents ?? 5000,
    commission,
    unitIds,
    unitOverrides,
    publicVisible: opts.publicVisible ?? false,
    priceVisibility: opts.priceVisibility ?? 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: opts.durationMinutes ?? 30,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, id, catalogDoc)
  return id
}

export async function linkMemberOperationToServices(
  orgId: string,
  memberOperationId: string,
  catalogServiceIds: string[],
): Promise<void> {
  const ref = aggregateRef(MemberOperationConfig, orgId, memberOperationId)
  const row = await readProjectionRow<MemberOperationRow>('member_operations', ref)
  if (!row)
    throw new Error(`linkMemberOperationToServices: memberOperation ${memberOperationId} not found`)
  const current = Schema.decodeUnknownSync(StoredMemberOperationSchema)(
    memberOperationRowToDoc(row),
  )
  const next: StoredMemberOperation = { ...current, catalogServiceIds: [...catalogServiceIds] }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'member_operation.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: MEMBER_OPERATION_COLUMNS,
    valuesAt: (v) => memberOperationColumnValues(next, v),
    table: 'member_operations',
    extraWrites: [
      { sql: MEMBER_OPERATION_SERVICES_DELETE, params: [orgId, memberOperationId] },
      ...memberOperationServiceRows(next).map((params) => ({
        sql: MEMBER_OPERATION_SERVICES_INSERT,
        params,
      })),
    ],
  })
}

export async function seedProduct(
  orgId: string,
  opts: {
    name?: string
    priceCents?: number
    stock?: number
    sku?: string
    unitIds?: string[]
  } = {},
): Promise<string> {
  const id = `e2e-prod-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const name = opts.name ?? 'Pomada'
  const priceCents = opts.priceCents ?? 3000
  const stock = opts.stock ?? 100
  const sku = opts.sku ?? null
  const unitIds = opts.unitIds ?? [await firstUnitIdForOrg(orgId)]
  const catalogDoc: CatalogProductItem = {
    id,
    orgId,
    kind: 'product',
    name,
    categoryId: null,
    priceCents,
    commission: null,
    unitIds,
    unitOverrides: null,
    publicVisible: false,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    sku,
    stock,
    gtin14: null,
    createdAt: now,
    updatedAt: now,
  }
  await seedCatalogItemDoc(orgId, id, catalogDoc)
  return id
}

export async function seedCatalogItem(
  orgId: string,
  opts: {
    kind?: 'service' | 'product'
    name?: string
    categoryId?: string | null
    priceCents?: number
    commission?: { kind: 'percentage' | 'fixed'; value: number } | null
    unitIds?: string[]
    publicVisible?: boolean
    active?: boolean
    durationMinutes?: number
    requiredResources?: string[]
    sku?: string | null
    stock?: number
  } = {},
): Promise<string> {
  const kind = opts.kind ?? 'service'
  const id = `e2e-catalog-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const commission = opts.commission ?? null
  const baseFields = {
    id,
    orgId,
    name: opts.name ?? (kind === 'service' ? 'Corte Catálogo' : 'Pomada Catálogo'),
    categoryId: opts.categoryId ?? null,
    priceCents: opts.priceCents ?? (kind === 'service' ? 5000 : 3000),
    commission,
    unitIds: opts.unitIds && opts.unitIds.length > 0 ? [...opts.unitIds] : ['e2e-default-unit'],
    unitOverrides: null,
    publicVisible: opts.publicVisible ?? false,
    priceVisibility: 'visible' as const,
    active: opts.active ?? true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const doc: CatalogItem =
    kind === 'service'
      ? {
          ...baseFields,
          kind: 'service',
          durationMinutes: opts.durationMinutes ?? 30,
          requiredResources: [...(opts.requiredResources ?? [])],
        }
      : {
          ...baseFields,
          kind: 'product',
          sku: opts.sku ?? null,
          stock: opts.stock ?? 100,
          gtin14: null,
        }
  await seedCatalogItemDoc(orgId, id, doc)
  return id
}

export async function seedCategory(
  orgId: string,
  opts: {
    name?: string
    icon?: string | null
    color?: string | null
    active?: boolean
    archivedAt?: string | null
  } = {},
): Promise<string> {
  const id = `e2e-cat-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: Category = {
    id,
    orgId,
    name: opts.name ?? 'Cabelo',
    icon: opts.icon ?? null,
    color: opts.color ?? null,
    active: opts.active ?? true,
    archivedAt: opts.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await seedCategoryDoc(orgId, doc)
  return id
}

export async function deleteCategory(orgId: string, categoryId: string): Promise<void> {
  await withEventStoreClient(async (q) => {
    await q(`DELETE FROM categories WHERE org_id = $1 AND id = $2`, [orgId, categoryId])
  })
}

export async function seedUnit(
  orgId: string,
  opts: { name?: string; slug?: string; archivedAt?: string | null } = {},
): Promise<string> {
  const id = `e2e-unit-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const slug = opts.slug ?? `unidade-${id}`.toLowerCase()
  const unitDoc: StoredUnit = {
    id,
    orgId,
    name: opts.name ?? 'Unidade Extra',
    slug,
    address: buildAddress(),
    timezone: 'America/Sao_Paulo',
    agenda: {
      mode: 'appointment',
      businessHours: EMPTY_BUSINESS_HOURS,
      slotMinutes: 15,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
      confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
    },
    archivedAt: opts.archivedAt ?? null,
    fiscal: { kind: 'informal' },
    createdAt: now,
    updatedAt: now,
  }
  await seedUnitDoc(orgId, id, unitDoc)
  const unitPii: UnitPii = { mobile: '5511900000000', email: null }
  await upsertUnitsPii(orgId, id, unitPii)
  return id
}

export async function seedSubscriptionPlan(
  orgId: string,
  opts: {
    name?: string
    priceCents?: number
    includedItemIds?: string[]
    includedCategoryIds?: string[]
    archivedAt?: string | null
  } = {},
): Promise<string> {
  const id = `e2e-plan-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const doc: SubscriptionPlan = {
    id,
    orgId,
    name: opts.name ?? 'Plano Baseline',
    description: null,
    priceCents: opts.priceCents ?? 9000,
    billingCycle: 'monthly',
    includedItemIds: [...(opts.includedItemIds ?? [])],
    includedCategoryIds: [...(opts.includedCategoryIds ?? [])],
    usageLimit: { kind: 'unlimited' },
    active: true,
    archivedAt: opts.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await seedSubscriptionPlanDoc(orgId, doc)
  return id
}

export async function readCatalogItem(
  orgId: string,
  catalogItemId: string,
): Promise<CatalogItem | null> {
  const row = await readProjectionRow<CatalogItemRow>(
    'catalog_items',
    aggregateRef(CatalogItemConfig, orgId, catalogItemId),
  )
  if (!row) return null
  return Schema.decodeUnknownSync(CatalogItemSchema)(catalogItemRowToDoc(row))
}

export async function patchAppointmentSnapshot(
  orgId: string,
  appointmentId: string,
  snapshot: {
    servicePriceCentsSnapshot: number
    commissionSnapshot: { kind: 'percentage' | 'fixed'; value: number } | null
  },
): Promise<void> {
  const ref = aggregateRef(AppointmentConfig, orgId, appointmentId)
  const row = await readProjectionRow<AppointmentRow>('appointments', ref)
  if (!row) throw new Error(`patchAppointmentSnapshot: appointment ${appointmentId} not found`)
  const current = Schema.decodeUnknownSync(AppointmentSchema)(appointmentRowToDoc(row))
  const next: Appointment = {
    ...current,
    servicePriceCentsSnapshot: snapshot.servicePriceCentsSnapshot,
    commissionSnapshot: snapshot.commissionSnapshot,
  }
  await mutateProjectionPostgres({
    ref,
    updatedTag: 'appointment.updated',
    data: next,
    updatedAt: new Date().toISOString(),
    columns: APPOINTMENT_COLUMNS,
    valuesAt: (v) => appointmentColumnValues(next, ref, v),
    table: 'appointments',
  })
}

export async function readAppointment(
  orgId: string,
  appointmentId: string,
): Promise<Appointment | null> {
  const row = await readProjectionRow<AppointmentRow>(
    'appointments',
    aggregateRef(AppointmentConfig, orgId, appointmentId),
  )
  if (!row) return null
  return Schema.decodeUnknownSync(AppointmentSchema)(appointmentRowToDoc(row))
}

export async function listAppointmentIds(orgId: string): Promise<string[]> {
  const rows = await pgListByOrg('appointments', orgId)
  return rows.map((r) => (typeof r.id === 'string' ? r.id : '')).filter((id) => id !== '')
}

export async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  return pgProjectionExists('agenda_blocks', aggregateRef(AgendaBlockConfig, orgId, blockId))
}

export async function seedOpenOrder(input: {
  orgId: string
  unitId: string
  customerId: string | null
  attributedUserId: string
  totalCents?: number
  createdAt?: string
}): Promise<string> {
  const id = `e2e-order-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const totalCents = input.totalCents ?? 1000
  const createdAt = input.createdAt ?? now
  const item: OrderItem = {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: totalCents,
    commission: null,
    attributedUserId: input.attributedUserId,
  }
  const doc: Order = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    customerId: input.customerId,
    appointmentId: null,
    status: 'open',
    items: [item],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: totalCents,
    totalCents,
    createdAt,
    updatedAt: createdAt,
  }
  const ref = aggregateRef(OrderConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'order.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORDER_COLUMNS,
    values: orderColumnValues(doc, ref, 1),
    table: 'orders',
  })
  return id
}

export async function seedClosedOrder(input: {
  orgId: string
  unitId: string
  customerId: string | null
  attributedUserId: string
  totalCents: number
  closedAt?: string
  paymentMethod?: Order['paymentMethod']
  subtotalCents?: number
  coverage?: OrderCoverage
  subscriptionId?: string | null
}): Promise<string> {
  const id = `e2e-order-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const closedAt = input.closedAt ?? now
  const subtotalCents = input.subtotalCents ?? input.totalCents
  const item: OrderItem = {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: subtotalCents,
    commission: null,
    attributedUserId: input.attributedUserId,
    ...(input.coverage ? { coverage: input.coverage } : {}),
    ...(input.coverage === 'subscription' ? { subscriptionId: input.subscriptionId ?? null } : {}),
  }
  const doc: Order = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    customerId: input.customerId,
    appointmentId: null,
    status: 'closed',
    items: [item],
    discountCents: 0,
    closedAt,
    paymentMethod: input.paymentMethod ?? 'cash',
    subtotalCents,
    totalCents: input.totalCents,
    createdAt: now,
    updatedAt: now,
  }
  const ref = aggregateRef(OrderConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'order.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORDER_COLUMNS,
    values: orderColumnValues(doc, ref, 1),
    table: 'orders',
  })
  return id
}

export async function seedCommission(input: {
  orgId: string
  attributedUserId: string
  amountCents: number
  liquidationStatus?: 'pendente' | 'pago'
  orderId?: string
  itemName?: string
  attributedMemberName?: string
}): Promise<string> {
  const id = `e2e-commission-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const status = input.liquidationStatus ?? 'pendente'
  const orderId = input.orderId ?? (await firstOrderIdForOrg(input.orgId))
  const doc: Commission = {
    id,
    orgId: input.orgId,
    orderId,
    orderItemId: 'item-1',
    attributedUserId: input.attributedUserId,
    attributedMemberName: input.attributedMemberName ?? 'E2E Profissional',
    itemKind: 'service',
    itemName: input.itemName ?? 'Corte',
    itemTotalCents: input.amountCents * 2,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: input.amountCents,
    liquidationStatus: status,
    paidAt: status === 'pago' ? now : null,
    paymentProof: null,
    createdAt: now,
  }
  const ref = aggregateRef(CommissionConfig, input.orgId, id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'commission.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: COMMISSION_COLUMNS,
    values: commissionColumnValues(doc, ref, 1),
    table: 'commissions',
  })
  return id
}

export type SeedBlockInput =
  | {
      kind: 'recurring'
      orgId: string
      unitId: string
      memberOperationId?: string | null
      weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
      open: string
      close: string
      reason: string
    }
  | {
      kind: 'one_off'
      orgId: string
      unitId: string
      memberOperationId?: string | null
      startAt: string
      endAt: string
      reason: string
    }

export async function seedBlock(input: SeedBlockInput): Promise<string> {
  const id = `e2e-block-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const base = {
    id,
    orgId: input.orgId,
    unitId: input.unitId,
    memberOperationId: input.memberOperationId ?? null,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  }
  const doc: AgendaBlock =
    input.kind === 'recurring'
      ? {
          ...base,
          kind: 'recurring',
          weekday: input.weekday,
          open: input.open,
          close: input.close,
          startAt: null,
          endAt: null,
        }
      : {
          ...base,
          kind: 'one_off',
          weekday: null,
          open: null,
          close: null,
          startAt: input.startAt,
          endAt: input.endAt,
        }
  await seedAgendaBlockDoc(input.orgId, doc)
  return id
}

export async function seedAuthUser(
  opts: { email?: string; password?: string; completionCompleted?: boolean } = {},
): Promise<{ uid: string; email: string; password: string }> {
  const password = opts.password ?? 'E2E12345!'
  const email = opts.email ?? `e2e+${uniqueSuffix()}@example.com`
  const uid = await createE2EIdentity(email, password)

  const completionCompleted = opts.completionCompleted ?? true
  const now = new Date().toISOString()
  await putUserDoc(
    buildUser(uid, now, {
      email,
      displayName: 'E2E Invitee',
      emailVerified: true,
      mobile: completionCompleted ? uniqueWhatsapp() : null,
      birthDate: completionCompleted ? '1990-01-01' : null,
      completionCompleted,
      claimedAt: now,
    }),
  )

  return { uid, email, password }
}

export type SeedInviteInput = {
  orgId: string
  mobile: string
  role: 'manager' | 'member_operator' | 'receptionist'
  invitedBy: string
  expiresAt?: string
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export async function seedInvite(
  input: SeedInviteInput,
): Promise<{ inviteId: string; rawToken: string }> {
  const inviteId = `e2e-invite-${uniqueSuffix()}`
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const now = new Date().toISOString()
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const status = input.status ?? 'pending'
  const accepted = status === 'accepted'
  const inviteDoc: StoredInvite = {
    id: inviteId,
    orgId: input.orgId,
    role: input.role,
    tokenHash,
    expiresAt,
    status,
    invitedBy: input.invitedBy,
    acceptedByUid: accepted ? `e2e-accepted-${uniqueSuffix()}` : null,
    acceptedAt: accepted ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  await seedInviteDoc(input.orgId, inviteDoc)
  const invitePii: InvitePii = { mobile: input.mobile }
  await upsertInvitePii({ orgId: input.orgId, id: inviteId, mobile: invitePii.mobile })
  return { inviteId, rawToken }
}

export async function readInviteStatus(orgId: string, inviteId: string): Promise<string | null> {
  const row = await readProjectionRow<InviteRow>(
    'invites',
    aggregateRef(InviteConfig, orgId, inviteId),
  )
  return row ? row.status : null
}

export async function readInvite(
  orgId: string,
  inviteId: string,
): Promise<{ status: string; acceptedByUid: string | null; acceptedAt: string | null } | null> {
  const row = await readProjectionRow<InviteRow>(
    'invites',
    aggregateRef(InviteConfig, orgId, inviteId),
  )
  if (!row) return null
  return {
    status: row.status,
    acceptedByUid: row.accepted_by_uid,
    acceptedAt: row.accepted_at == null ? null : new Date(row.accepted_at).toISOString(),
  }
}

export type ReadMembershipResult = {
  orgId: string
  role: string
  status: string
  rlsUnitScope: string | null
  permissions: Record<string, boolean> | null
}

export async function readMembership(membershipId: string): Promise<ReadMembershipResult | null> {
  const row = await readMembershipRowById(membershipId)
  if (!row) return null
  const doc = Schema.decodeUnknownSync(MembershipSchema)(membershipRowToDoc(row))
  return {
    orgId: doc.orgId,
    role: doc.role,
    status: doc.status,
    rlsUnitScope: doc.rlsUnitScope,
    permissions: doc.permissions,
  }
}

export async function readUser(uid: string): Promise<User | null> {
  return getUserById(uid)
}

export async function signInAndAttachSession(
  context: BrowserContext,
  email: string,
  password = 'E2E12345!',
  appUrl: string = appBaseUrl(),
): Promise<void> {
  const res = await fetch(`${appUrl}/api/e2e-signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`e2e sign-in failed for ${email}: ${res.status} ${await res.text()}`)
  const cookies = res.headers.getSetCookie().map((header) => {
    const [pair = ''] = header.split(';')
    const eq = pair.indexOf('=')
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
  })
  if (cookies.length === 0) throw new Error(`e2e sign-in for ${email} set no session cookie`)
  await context.addCookies(
    cookies.map((c) => ({ ...c, url: appUrl, httpOnly: false, sameSite: 'Lax' as const })),
  )
}

export const ACTIVE_UNIT_COOKIE = 'activeUnitId'

export async function setActiveUnitCookie(
  context: BrowserContext,
  unitId: string,
  appUrl = 'http://127.0.0.1:3005',
): Promise<void> {
  const url = new URL(appUrl)
  await context.addCookies([
    {
      name: ACTIVE_UNIT_COOKIE,
      value: unitId,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

export async function enterUnitsAfterCreate(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 })
  await page.waitForURL(/\/(organizations|units|select-unit|agenda)$/, { timeout: 10000 })
  await page.goto('/organizations')
  if (/\/select-unit$/.test(new URL(page.url()).pathname)) {
    const unitId = await page
      .getByRole('button', { name: /Unidade/ })
      .first()
      .getAttribute('value')
    if (unitId) await setActiveUnitCookie(page.context(), unitId, page.url())
    await page.goto('/organizations')
  }
  await expect(page).toHaveURL(/\/organizations(\/|\?|$)/)
  await expect(page.getByRole('heading', { name: 'Negócios', level: 1 })).toBeVisible()
}

export async function seedProductBase(opts: {
  gtin14: string
  name?: string
  brand?: string | null
  source?: 'official' | 'external' | 'org-contributed'
}): Promise<void> {
  const { PostgresProductSource } = await import('@/product')
  await new PostgresProductSource().upsert({
    gtin14: opts.gtin14,
    name: opts.name ?? 'Produto Semeado',
    brand: opts.brand ?? null,
    source: opts.source ?? 'official',
  })
}

export async function readProductBase(
  gtin14: string,
): Promise<{ name: string; source: string } | null> {
  const { PostgresProductSource } = await import('@/product')
  const row = await new PostgresProductSource().findByGtin14(gtin14)
  return row === null ? null : { name: row.name, source: row.source }
}

export async function deleteProductBaseForWorker(gtins: readonly string[]): Promise<void> {
  if (gtins.length === 0) return
  const { getDb, product } = await import('@/product')
  const { inArray } = await import('drizzle-orm')
  await getDb()
    .delete(product)
    .where(inArray(product.gtin14, [...gtins]))
}

async function seedCatalogItemPostgres(orgId: string, id: string, doc: CatalogItem): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  const ref = aggregateRef(CatalogItemConfig, orgId, id)
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        ref.type,
        ref.id,
        ref.orgId,
        {
          _tag: 'catalog_item.created',
          version: 1,
          timestamp: doc.createdAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: doc },
        },
      ],
    )
    const placeholders = CATALOG_ITEM_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO catalog_items (${CATALOG_ITEM_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      catalogItemColumnValues(doc, 1),
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

async function seedCatalogItemDoc(orgId: string, id: string, doc: CatalogItem): Promise<void> {
  await seedCatalogItemPostgres(orgId, id, doc)
}

function withDerivedMemberId(
  table: string,
  columns: readonly string[],
): { columnList: string; valueSuffix: string; conflictSet: string } {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  if (table !== 'appointments' && table !== 'agenda_blocks') {
    return {
      columnList: columns.join(', '),
      valueSuffix: placeholders,
      conflictSet: columns.map((col, i) => `${col} = $${i + 1}`).join(', '),
    }
  }
  const orgIdRef = `$${columns.indexOf('org_id') + 1}`
  const memberOpIdRef = `$${columns.indexOf('member_operation_id') + 1}`
  const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdRef} AND mo.id = ${memberOpIdRef})`
  return {
    columnList: [...columns, 'member_id'].join(', '),
    valueSuffix: `${placeholders}, ${memberIdDerived}`,
    conflictSet: [
      ...columns.map((col, i) => `${col} = $${i + 1}`),
      `member_id = ${memberIdDerived}`,
    ].join(', '),
  }
}

async function seedIdentityPostgres(args: {
  ref: AggregateRef
  createdTag: string
  data: unknown
  createdAt: string
  columns: readonly string[]
  values: readonly unknown[]
  table: string
  extraWrites?: readonly { sql: string; params: readonly unknown[] }[]
}): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        args.ref.type,
        args.ref.id,
        args.ref.orgId,
        {
          _tag: args.createdTag,
          version: 1,
          timestamp: args.createdAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: args.data },
        },
      ],
    )
    const { columnList, valueSuffix } = withDerivedMemberId(args.table, args.columns)
    await client.query(`INSERT INTO ${args.table} (${columnList}) VALUES (${valueSuffix})`, [
      ...args.values,
    ])
    for (const w of args.extraWrites ?? []) {
      await client.query(w.sql, [...w.params])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

async function mutateProjectionPostgres(args: {
  ref: AggregateRef
  updatedTag: string
  data: unknown
  updatedAt: string
  columns: readonly string[]
  valuesAt: (version: number) => readonly unknown[]
  table: string
  extraWrites?: readonly { sql: string; params: readonly unknown[] }[]
}): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<{ last_event_version: number }>(
      `SELECT last_event_version FROM ${args.table} WHERE org_id = $1 AND id = $2`,
      [args.ref.orgId, args.ref.id],
    )
    const nextVersion = (cur.rows[0]?.last_event_version ?? 1) + 1
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        args.ref.type,
        args.ref.id,
        nextVersion,
        args.ref.orgId,
        {
          _tag: args.updatedTag,
          version: nextVersion,
          timestamp: args.updatedAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: args.data },
        },
      ],
    )
    const values = args.valuesAt(nextVersion)
    const { columnList, valueSuffix, conflictSet } = withDerivedMemberId(args.table, args.columns)
    await client.query(
      `INSERT INTO ${args.table} (${columnList}) VALUES (${valueSuffix})
       ON CONFLICT (org_id, id) DO UPDATE SET ${conflictSet}`,
      [...values],
    )
    for (const w of args.extraWrites ?? []) {
      await client.query(w.sql, [...w.params])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

async function withEventStoreClient<T>(
  fn: (
    q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  ) => Promise<T>,
): Promise<T> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    return await fn((sql, params) => client.query(sql, params))
  } finally {
    await client.end()
  }
}

export async function pgReadProjection(
  table: string,
  ref: AggregateRef,
): Promise<Record<string, unknown> | null> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    return res.rows[0] ?? null
  })
}

export async function pgProjectionExists(table: string, ref: AggregateRef): Promise<boolean> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2 LIMIT 1`, [
      ref.orgId,
      ref.id,
    ])
    return res.rows.length > 0
  })
}

export function timestamptzToIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return new Date(value).toISOString()
  throw new TypeError(`timestamptzToIso: unexpected cell type ${typeof value}`)
}

export async function pgQueryProjection(
  table: string,
  whereColumn: string,
  value: unknown,
): Promise<Record<string, unknown>[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE ${whereColumn} = $1`, [value])
    return res.rows
  })
}

export async function pgListByOrg(
  table: string,
  orgId: string,
): Promise<Record<string, unknown>[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(`SELECT * FROM ${table} WHERE org_id = $1`, [orgId])
    return res.rows
  })
}

export async function pgReadEventStream(ref: AggregateRef): Promise<unknown[]> {
  return withEventStoreClient(async (q) => {
    const res = await q(
      `SELECT envelope FROM events
       WHERE aggregate_type = $1 AND org_id = $2 AND aggregate_id = $3
       ORDER BY version ASC`,
      [ref.type, ref.orgId, ref.id],
    )
    return res.rows.map((r) => r.envelope)
  })
}

async function readProjectionRow<Row extends Record<string, unknown>>(
  table: string,
  ref: AggregateRef,
): Promise<Row | null> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<Row>(`SELECT * FROM ${table} WHERE org_id = $1 AND id = $2`, [
      ref.orgId,
      ref.id,
    ])
    return res.rows[0] ?? null
  } finally {
    await client.end()
  }
}

async function putUserDoc(user: User): Promise<void> {
  await putUser(user)
}

async function seedOrgDoc(orgId: string, doc: StoredOrg): Promise<void> {
  const ref = aggregateRef(OrgConfig, orgId, orgId)
  await seedIdentityPostgres({
    ref,
    createdTag: 'org.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: ORG_COLUMNS,
    values: orgColumnValues(doc, 1),
    table: 'orgs',
    extraWrites: [{ sql: PUBLIC_DIRECTORY_UPSERT, params: publicOrgDirectoryValues(doc) }],
  })
}

async function seedUnitDoc(orgId: string, unitId: string, doc: StoredUnit): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(UnitConfig, orgId, unitId),
    createdTag: 'unit.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: UNIT_COLUMNS,
    values: unitColumnValues(doc, 1),
    table: 'units',
  })
}

async function seedMembershipDoc(membership: Membership): Promise<void> {
  const ref = aggregateRef(MembershipConfig, membership.orgId, membership.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'membership.created',
    data: membership,
    createdAt: membership.joinedAt,
    columns: MEMBERSHIP_COLUMNS,
    values: membershipColumnValues(membership, ref, 1),
    table: 'memberships',
  })
}

async function seedMemberOperationDoc(orgId: string, doc: StoredMemberOperation): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(MemberOperationConfig, orgId, doc.id),
    createdTag: 'member_operation.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: MEMBER_OPERATION_COLUMNS,
    values: memberOperationColumnValues(doc, 1),
    table: 'member_operations',
    extraWrites: [
      ...memberOperationUnitRows(doc).map((params) => ({
        sql: MEMBER_OPERATION_UNITS_INSERT,
        params,
      })),
      ...memberOperationServiceRows(doc).map((params) => ({
        sql: MEMBER_OPERATION_SERVICES_INSERT,
        params,
      })),
    ],
  })
}

async function seedCustomerDoc(orgId: string, doc: StoredCustomer): Promise<void> {
  const ref = aggregateRef(CustomerConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'customer.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CUSTOMER_COLUMNS,
    values: customerColumnValues(doc, ref, 1),
    table: 'customers',
  })
}

async function seedInviteDoc(orgId: string, doc: StoredInvite): Promise<void> {
  const ref = aggregateRef(InviteConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'invite.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: INVITE_COLUMNS,
    values: inviteColumnValues(doc, ref, 1),
    table: 'invites',
  })
}

async function seedCategoryDoc(orgId: string, doc: Category): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(CategoryConfig, orgId, doc.id),
    createdTag: 'category.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: CATEGORY_COLUMNS,
    values: categoryColumnValues(doc, 1),
    table: 'categories',
  })
}

async function seedSubscriptionPlanDoc(orgId: string, doc: SubscriptionPlan): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(SubscriptionPlanConfig, orgId, doc.id),
    createdTag: 'subscription_plan.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: SUBSCRIPTION_PLAN_COLUMNS,
    values: subscriptionPlanColumnValues(doc, 1),
    table: 'subscription_plans',
  })
}

async function seedAgendaBlockDoc(orgId: string, doc: AgendaBlock): Promise<void> {
  await seedIdentityPostgres({
    ref: aggregateRef(AgendaBlockConfig, orgId, doc.id),
    createdTag: 'agenda_block.created',
    data: doc,
    createdAt: doc.createdAt,
    columns: AGENDA_BLOCK_COLUMNS,
    values: agendaBlockColumnValues(doc, 1),
    table: 'agenda_blocks',
  })
}

async function seedGoalDoc(orgId: string, doc: Goal): Promise<void> {
  const ref = aggregateRef(GoalConfig, orgId, doc.id)
  await seedIdentityPostgres({
    ref,
    createdTag: 'goal.defined',
    data: doc,
    createdAt: doc.createdAt,
    columns: GOAL_COLUMNS,
    values: goalColumnValues(doc, ref, 1),
    table: 'goals',
  })
}

export async function readCatalogItemByNameForAssert(
  orgId: string,
  name: string,
): Promise<{ name: string; categoryId: string | null; gtin14: string | null } | null> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    const res = await client.query<{
      name: string
      category_id: string | null
      gtin14: string | null
    }>('SELECT name, category_id, gtin14 FROM catalog_items WHERE org_id = $1 AND name = $2', [
      orgId,
      name,
    ])
    const row = res.rows[0]
    return row ? { name: row.name, categoryId: row.category_id, gtin14: row.gtin14 } : null
  } finally {
    await client.end()
  }
}

export const skipOnPostgres = (): boolean => true
