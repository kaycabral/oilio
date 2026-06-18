import {
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_SLOT_MINUTES,
  type Org,
  StoredOrg,
  type TaxIdentity,
  TaxIdentity as TaxIdentitySchema,
  isValidSlotMinutes,
  normalizeCancellationPolicy,
  normalizeOrgBranding,
  resolveWhatsappTemplates,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import 'server-only'

// What we actually persist under `orgs/{id}` (the event projection). The
// owner's `taxIdentity` (CPF/CNPJ — PII) is merged in at read time from the
// deletable `orgs/{id}/private/taxIdentity` doc. `name` is the BUSINESS
// name (not PII) and stays on the doc. See #1036 + ADR 0010 (LGPD). The
// storage projection schema is the read-model `StoredOrg` from `@/domain`.

// Subcollection + doc id that hold the org's tax PII.
const PRIVATE_COLLECTION = 'private'
const TAX_IDENTITY_DOC = 'taxIdentity'

const TaxIdentityDocSchema = Schema.Struct({ taxIdentity: Schema.NullOr(TaxIdentitySchema) })

function normalizeOrg(t: StoredOrg, taxIdentity: TaxIdentity | null): Org {
  return {
    ...t,
    taxIdentity,
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

// Read the deletable tax PII doc for a org. null when absent (e.g. owner
// hasn't filled it yet, or it was erased — LGPD).
async function getOrgTaxIdentity(orgId: string): Promise<TaxIdentity | null> {
  const snap = await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection(PRIVATE_COLLECTION)
    .doc(TAX_IDENTITY_DOC)
    .withConverter(fsConverter(TaxIdentityDocSchema))
    .get()
  return snap.data()?.taxIdentity ?? null
}

// Write the tax PII doc directly (mutable, deletable, NOT event-sourced).
// Called from the company-update action alongside the domain event emission.
export async function writeOrgTaxIdentity(
  orgId: string,
  taxIdentity: TaxIdentity | null,
): Promise<void> {
  await getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection(PRIVATE_COLLECTION)
    .doc(TAX_IDENTITY_DOC)
    .set({ taxIdentity })
}

export async function getOrg(orgId: string): Promise<Org | null> {
  const [snap, taxIdentity] = await Promise.all([
    getAdminFirestore().collection('orgs').doc(orgId).withConverter(fsConverter(StoredOrg)).get(),
    getOrgTaxIdentity(orgId),
  ])
  const data = snap.data()
  if (!data) return null
  return normalizeOrg(data, taxIdentity)
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
  const taxIdentity = await getOrgTaxIdentity(doc.id)
  return normalizeOrg(data, taxIdentity)
}
