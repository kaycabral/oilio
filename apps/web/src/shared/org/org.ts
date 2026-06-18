import { DEFAULT_UNIT_TIMEZONE, type Org, StoredOrg, normalizeOrgBranding } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import 'server-only'

// What we persist under `orgs/{id}` (the event projection). The Org is a pure
// folder/shell (PRD Identidade v2) — it has NO fiscal identity (the CNPJ moved
// to `Unit.fiscal`, brief 0048) and NO agenda/self-booking config (timezone,
// slotMinutes, cancellationPolicy, confirmation messages, self-booking publish
// state moved to `Unit.agenda`), so the stored shape equals the read model
// `StoredOrg`. `name` is the BUSINESS name (not titular PII) and stays on the
// doc. The owner's CPF lives on `User.taxIdentity`, never here.

function normalizeOrg(t: StoredOrg): Org {
  return {
    ...t,
    branding: normalizeOrgBranding(t.branding),
  }
}

export async function getOrg(orgId: string): Promise<Org | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .withConverter(fsConverter(StoredOrg))
    .get()
  const data = snap.data()
  if (!data) return null
  return normalizeOrg(data)
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .where('slug', '==', slug)
    .limit(1)
    .withConverter(fsConverter(StoredOrg))
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  if (!doc) return null
  const data = doc.data()
  if (!data) return null
  return normalizeOrg(data)
}

// Representative timezone for an ORG-SCOPED aggregate (dashboard, reports,
// copilot, daily notifications header) after the tz moved Org→Unit (PRD
// Identidade v2). The timezone is the establishment's, so an org-wide view has
// no single tz; we use the first active unit's tz (units are listed ordered by
// name), falling back to the default when the org has no unit yet. LIMITATION:
// when units span timezones, the org-wide aggregate renders in this one unit's
// tz — acceptable for the V0 single-tz-per-org reality; per-unit views use the
// unit's own tz.
export async function getOrgRepresentativeTimezone(orgId: string): Promise<string> {
  const units = await listUnitsForOrg(orgId)
  return units[0]?.timezone ?? DEFAULT_UNIT_TIMEZONE
}
