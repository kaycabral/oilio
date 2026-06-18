import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_SLOT_MINUTES,
  type Org,
  StoredOrg,
  isValidSlotMinutes,
  normalizeCancellationPolicy,
  normalizeOrgBranding,
  resolveWhatsappTemplates,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import 'server-only'

// What we persist under `orgs/{id}` (the event projection). The Org is a pure
// folder/shell (PRD Identidade v2) — it has NO fiscal identity anymore (the
// CNPJ moved to `Unit.fiscal`, brief 0048), so the stored shape equals the read
// model `StoredOrg`. `name` is the BUSINESS name (not titular PII) and stays on
// the doc. The owner's CPF lives on `User.taxIdentity`, never here.

function normalizeOrg(t: StoredOrg): Org {
  return {
    ...t,
    timezone: t.timezone || DEFAULT_ORG_TIMEZONE,
    slotMinutes: isValidSlotMinutes(t.slotMinutes) ? t.slotMinutes : DEFAULT_SLOT_MINUTES,
    branding: normalizeOrgBranding(t.branding),
    cancellationPolicy: normalizeCancellationPolicy(t.cancellationPolicy),
    whatsappTemplates: resolveWhatsappTemplates(t.whatsappTemplates),
    // Pre-#988 orgs have no `selfBookingPublished` field — default to false
    // (unpublished) so a missing flag never leaks a public page.
    selfBookingPublished: t.selfBookingPublished === true,
    selfBookingPublishedAt: t.selfBookingPublishedAt ?? null,
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
