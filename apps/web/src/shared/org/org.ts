import { DEFAULT_UNIT_TIMEZONE, type Org, StoredOrg, normalizeOrgBranding } from '@/domain'
import { type OrgRow, rowToDoc } from '@/shared/db/pg/effect/org-projector'
import { getPublicOrgDocBySlug } from '@/shared/db/pg/public-org-directory'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrg = Schema.decodeUnknownSync(StoredOrg)

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
  const rows = await readUnderRls<OrgRow>(orgId, (client) =>
    client.query<OrgRow>('SELECT * FROM orgs WHERE org_id = $1', [orgId]).then((res) => res.rows),
  )
  const row = rows[0]
  return row ? normalizeOrg(decodeOrg(rowToDoc(row))) : null
}

// PUBLIC, pre-auth resolution (the public booking page resolves slug → org
// BEFORE any org context exists). There is no `app.current_org` to scope by —
// the org is precisely what this resolves — so it reads the public org directory
// (a public-by-contract projection, no RLS; brief 0062), NOT the org-scoped
// `orgs` table. The directory carries exactly the public fields, so the
// `StoredOrg` decode round-trips.
export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const doc = await getPublicOrgDocBySlug(slug)
  if (!doc) return null
  return normalizeOrg(decodeOrg(doc))
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
