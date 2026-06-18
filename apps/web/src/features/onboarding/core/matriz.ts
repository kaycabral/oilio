// Functional core for the auto-created matriz unit (F2 / brief 0046). Pure:
// no I/O — the createOrg saga (adapters) does the slug-uniqueness lookup and the
// event emission. Keeping the slug-candidate derivation and the StoredUnit
// shaping here makes the saga's branching thin and unit-testable.

import {
  isValidUnitSlug,
  slugifyUnitName,
  type StoredUnit,
  type UnitPii,
  type User,
} from '@/domain'

// Ordered list of slug candidates derived from the org name: the slugified
// base (or a fallback), escaping the reserved set, then `-2`, `-3`, … The saga
// walks this list and picks the first one free within the (brand-new) org.
// Pure + deterministic so the uniqueness loop has a tested source of truth.
export function matrizSlugCandidates(name: string, maxAttempts: number): string[] {
  const base = slugifyUnitName(name) || 'unidade'
  const safeBase = isValidUnitSlug(base) ? base : `${base}-1`
  const out: string[] = []
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? safeBase : `${safeBase}-${i + 1}`
    if (isValidUnitSlug(candidate)) out.push(candidate)
  }
  return out
}

// Resolve the matriz unit's PII (the `units_pii` doc) from the owner's profile.
// `whatsapp` is REQUIRED by the UnitPii schema; we derive it from the owner's
// completed User. The org-creation route gates on `completionCompleted`, so a
// reachable owner has it set — but the saga defends itself rather than ever
// persisting an empty whatsapp (which would be invalid PII). Returns an error
// marker when the profile has no whatsapp; the saga surfaces it to the user.
export type MatrizPiiResult = { ok: true; pii: UnitPii } | { ok: false; error: string }

export function resolveMatrizPii(owner: User | null): MatrizPiiResult {
  const whatsapp = owner?.whatsapp ?? null
  if (!whatsapp) {
    return { ok: false, error: 'Complete seu perfil (WhatsApp) antes de criar a empresa.' }
  }
  return { ok: true, pii: { whatsapp, email: owner?.email ?? null } }
}

// Shape the matriz StoredUnit (the event projection). PII (whatsapp/email) is
// NOT part of StoredUnit — it goes to the deletable `units_pii` doc. The matriz
// starts informal: no address/businessHours yet (the owner fills those just-in-
// time). `name` mirrors the org name for friendliness.
export function buildMatrizUnit(input: {
  unitId: string
  orgId: string
  name: string
  slug: string
  now: string
}): StoredUnit {
  return {
    id: input.unitId,
    orgId: input.orgId,
    name: input.name,
    slug: input.slug,
    address: null,
    businessHours: null,
    archivedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}
