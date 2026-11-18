import { normalizeBrazilMobile, type Attribution, type StoredCustomer, type User } from '@/domain'
import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/unique-violation'
import { putUser } from '@/shared/db/pg/users-store'
import { emitEvent } from '@/shared/effect-bridge'
import { linkCustomerOrg } from '@/shared/identity/org-links'
import { randomUUID } from 'node:crypto'

const WHATSAPP_IN_USE_ERROR =
  'Esse número de WhatsApp já pertence a outro cliente. Envie um convite para que a pessoa faça o próprio cadastro.'

export type { StoredCustomer } from '@/domain'

export type UpsertCustomerInput = {
  orgId: string
  name: string
  mobileRaw: string
  email: string | null
  birthDate: string | null
  acquisition?: Attribution | null
}

export type UpsertCustomerResult =
  { ok: true; customerId: string; userId: string } | { ok: false; error: string }

function buildUserStub(
  userId: string,
  input: UpsertCustomerInput,
  mobile: string,
  now: string,
): User {
  return {
    uid: userId,
    email: input.email,
    displayName: input.name,
    avatarUrl: null,
    emailVerified: false,
    currentOrgId: null,
    mobile,
    birthDate: input.birthDate,
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: false,
    claimedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    anonymizedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function findCustomerIdByUserId(orgId: string, userId: string): Promise<string | null> {
  const rows = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM customers WHERE org_id = $1 AND user_id = $2 LIMIT 1', [orgId, userId])
      .then((res) => res.rows),
  )
  return rows[0]?.id ?? null
}

export async function upsertCustomerWithUser(
  input: UpsertCustomerInput,
): Promise<UpsertCustomerResult> {
  const mobile = normalizeBrazilMobile(input.mobileRaw)
  if (!mobile) {
    return { ok: false, error: 'Informe um celular com DDD e 9 dígitos (ex.: 11 91234-5678)' }
  }

  const now = new Date().toISOString()

  const userId = randomUUID()
  try {
    await putUser(buildUserStub(userId, input, mobile, now))
  } catch (err) {
    if (isUniqueViolation(err, USERS_MOBILE_UNIQUE)) {
      return { ok: false, error: WHATSAPP_IN_USE_ERROR }
    }
    throw err
  }

  const existingId = await findCustomerIdByUserId(input.orgId, userId)
  if (existingId) {
    return { ok: true, customerId: existingId, userId }
  }

  const customerId = randomUUID()
  const customer: StoredCustomer = {
    id: customerId,
    orgId: input.orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: input.acquisition ?? null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(
    CustomerConfig,
    aggregateRef(CustomerConfig, input.orgId, customerId),
    {
      _tag: 'customer.created',
      actorId: userId,
      payload: { data: customer },
    },
  )
  if (!created.ok) return { ok: false, error: created.error }
  await linkCustomerOrg(userId, input.orgId)

  return { ok: true, customerId, userId }
}

export async function ensureSelfSignupCustomer(
  orgId: string,
  userId: string,
  acquisition: Attribution | null = null,
): Promise<{ customerId: string; created: boolean }> {
  const existingId = await findCustomerIdByUserId(orgId, userId)
  if (existingId) {
    return { customerId: existingId, created: false }
  }
  const customerId = randomUUID()
  const now = new Date().toISOString()
  const customer: StoredCustomer = {
    id: customerId,
    orgId,
    userId,
    archivedAt: null,
    deactivatedAt: null,
    acquisition,
    createdAt: now,
    updatedAt: now,
  }
  const ev = await emitEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, customerId), {
    _tag: 'customer.created',
    actorId: userId,
    payload: { data: customer },
  })
  if (!ev.ok) throw new Error(ev.error)
  await linkCustomerOrg(userId, orgId)
  return { customerId, created: true }
}
