// Server-side reads that hydrate Customer docs with PII from the global
// `users/{userId}` collection so the UI consumes a single `Customer`
// shape and does not have to know about the User/Customer split. See
// #832 + #836 — wiki: 02-Estrategia-Modelo-Identidade.

import {
  type Customer,
  StoredCustomer,
  User,
  resolveSubjectAvatar,
  resolveSubjectName,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'

// A blocked customer (brief 0032, AC-09/AC-11) is recognized at read time by
// the materialized `archivedAt` field on the customer shadow — the fail-safe
// projection of the `blocked_subjects/{userId}` marker. Trusting the doc field
// (self-describing, indexable) means a forgotten join never leaks a blocked
// customer as active.
function isBlockedCustomer(c: StoredCustomer): boolean {
  return c.archivedAt !== null && c.archivedAt !== undefined
}

function emptyEnrichment(c: StoredCustomer): Customer {
  // The User doc went missing. UI degrades gracefully — placeholder text
  // surfaces the bug without crashing the page.
  return {
    ...c,
    name: '(usuário não encontrado)',
    whatsapp: '',
    email: null,
    birthDate: null,
    avatarUrl: null,
    archivedAt: c.archivedAt ?? null,
    deactivatedAt: c.deactivatedAt ?? null,
  }
}

function mergeWithUser(c: StoredCustomer, u: User | undefined): Customer {
  if (!u) return emptyEnrichment(c)
  // Anonymized accounts (LGPD #1095, AC-03) resolve to the neutral label
  // `Cliente ‹CODE›` — contact PII is scrubbed to null on the global doc. A
  // customer blocked in THIS org (#1096/#1100, AC-09) resolves to the same
  // neutral label + blanked avatar (AC-13) here, even though the global account
  // keeps its name. The block is detected from the customer's own `archivedAt`
  // projection — never from the professional relationship (kept identifiable).
  const blockedInOrg = isBlockedCustomer(c)
  const name = resolveSubjectName(c.userId, u, 'Cliente', { blockedInOrg }) ?? ''
  return {
    ...c,
    name,
    whatsapp: blockedInOrg ? '' : (u.whatsapp ?? ''),
    email: blockedInOrg ? null : u.email,
    birthDate: blockedInOrg ? null : u.birthDate,
    // Avatar neutralized (AC-13) when blocked — the photo is a re-identification
    // vector. The global User keeps its avatar; only this org blanks it.
    avatarUrl: resolveSubjectAvatar(u, { blockedInOrg }),
    archivedAt: c.archivedAt ?? null,
    deactivatedAt: c.deactivatedAt ?? null,
  }
}

async function fetchUsersByIds(
  uids: readonly (string | null | undefined)[],
): Promise<Map<string, User>> {
  // Clientes avulsos não têm usuário vinculado (userId null/''). Filtra antes
  // do `.doc()` — `db.collection('users').doc('')` estoura ("documentPath is
  // not a valid resource path").
  const unique = [...new Set(uids.filter((uid): uid is string => Boolean(uid)))]
  if (unique.length === 0) return new Map()
  const db = getAdminFirestore()
  const refs = unique.map((uid) => db.collection('users').doc(uid))
  const snaps = await db.getAll(...refs)
  return new Map(
    snaps.flatMap((s) => {
      const raw = s.data()
      const v = raw ? decodeAs(User, raw) : undefined
      return v ? [[s.id, v] as const] : []
    }),
  )
}

// Hydrate a batch of Customer docs in one round-trip to the users collection.
// Order is preserved. A blocked customer (#1096/#1100, AC-09) is detected from
// its own materialized `archivedAt` and rendered with the neutral label/avatar
// — no separate blocked-set read is needed (the fact lives on the shadow).
export async function enrichCustomers(
  _orgId: string,
  customers: readonly StoredCustomer[],
): Promise<Customer[]> {
  if (customers.length === 0) return []
  const users = await fetchUsersByIds(customers.map((c) => c.userId))
  return customers.map((c) => mergeWithUser(c, users.get(c.userId)))
}

// All customers of a org, INCLUDING blocked/archived ones (resolved to the
// neutral label). Use for history/reports/detail where a past customer must
// still resolve. For active lists/pickers use `listActiveCustomersForOrg`.
export async function listCustomersForOrg(orgId: string): Promise<Customer[]> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('customers')
    .withConverter(fsConverter(StoredCustomer))
    .get()
  // `id` vem do doc ref (fonte de verdade), nunca do campo denormalizado —
  // docs com `id` ausente/vazio (dado legado/sujo) quebrariam delete/links.
  const customers = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
  return enrichCustomers(orgId, customers)
}

// ACTIVE customers only — drops two distinct non-active states (filtered in JS;
// the collection is org-scoped and small, avoiding an index on fields that
// are null for the overwhelming majority of docs):
//   - `archivedAt` → LGPD block (#1100, AC-09/AC-11): resolves to the neutral
//     label in history; gone from active lists/pickers.
//   - `deactivatedAt` → operator removal (brief 0033, AC-07): keeps the NAME in
//     history; gone from active lists/pickers.
// History/reports still resolve both via `listCustomersForOrg`.
export async function listActiveCustomersForOrg(orgId: string): Promise<Customer[]> {
  const all = await listCustomersForOrg(orgId)
  return all.filter((c) => c.archivedAt === null && c.deactivatedAt === null)
}

export async function getCustomerById(orgId: string, customerId: string): Promise<Customer | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('customers')
    .doc(customerId)
    .withConverter(fsConverter(StoredCustomer))
    .get()
  const data = snap.data()
  const customer = data ? { ...data, id: snap.id } : undefined
  if (!customer) return null
  const [enriched] = await enrichCustomers(orgId, [customer])
  return enriched ?? null
}
