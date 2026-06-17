import {
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TENANT_TIMEZONE,
  StoredTenant,
  type TaxIdentity,
  TaxIdentity as TaxIdentitySchema,
  type Tenant,
  isValidSlotMinutes,
  normalizeCancellationPolicy,
  normalizeTenantBranding,
  resolveWhatsappTemplates,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'
import 'server-only'

// What we actually persist under `tenants/{id}` (the event projection). The
// owner's `taxIdentity` (CPF/CNPJ — PII) is merged in at read time from the
// deletable `tenants/{id}/private/taxIdentity` doc. `name` is the BUSINESS
// name (not PII) and stays on the doc. See #1036 + ADR 0010 (LGPD). The
// storage projection schema is the read-model `StoredTenant` from `@/domain`.

// Subcollection + doc id that hold the tenant's tax PII.
const PRIVATE_COLLECTION = 'private'
const TAX_IDENTITY_DOC = 'taxIdentity'

const TaxIdentityDocSchema = Schema.Struct({ taxIdentity: Schema.NullOr(TaxIdentitySchema) })

function normalizeTenant(t: StoredTenant, taxIdentity: TaxIdentity | null): Tenant {
  return {
    ...t,
    taxIdentity,
    timezone: t.timezone || DEFAULT_TENANT_TIMEZONE,
    slotMinutes: isValidSlotMinutes(t.slotMinutes) ? t.slotMinutes : DEFAULT_SLOT_MINUTES,
    branding: normalizeTenantBranding(t.branding),
    cancellationPolicy: normalizeCancellationPolicy(t.cancellationPolicy),
    whatsappTemplates: resolveWhatsappTemplates(t.whatsappTemplates),
    // Pre-#988 tenants have no `selfBookingPublished` field — default to false
    // (unpublished) so a missing flag never leaks a public page.
    selfBookingPublished: t.selfBookingPublished === true,
    selfBookingPublishedAt: t.selfBookingPublishedAt ?? null,
  }
}

// Read the deletable tax PII doc for a tenant. null when absent (e.g. owner
// hasn't filled it yet, or it was erased — LGPD).
async function getTenantTaxIdentity(tenantId: string): Promise<TaxIdentity | null> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection(PRIVATE_COLLECTION)
    .doc(TAX_IDENTITY_DOC)
    .withConverter(fsConverter(TaxIdentityDocSchema))
    .get()
  return snap.data()?.taxIdentity ?? null
}

// Write the tax PII doc directly (mutable, deletable, NOT event-sourced).
// Called from the company-update action alongside the domain event emission.
export async function writeTenantTaxIdentity(
  tenantId: string,
  taxIdentity: TaxIdentity | null,
): Promise<void> {
  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection(PRIVATE_COLLECTION)
    .doc(TAX_IDENTITY_DOC)
    .set({ taxIdentity })
}

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const [snap, taxIdentity] = await Promise.all([
    getAdminFirestore()
      .collection('tenants')
      .doc(tenantId)
      .withConverter(fsConverter(StoredTenant))
      .get(),
    getTenantTaxIdentity(tenantId),
  ])
  const data = snap.data()
  if (!data) return null
  return normalizeTenant(data, taxIdentity)
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const snap = await getAdminFirestore()
    .collection('tenants')
    .where('slug', '==', slug)
    .limit(1)
    .withConverter(fsConverter(StoredTenant))
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  if (!doc) return null
  const data = doc.data()
  if (!data) return null
  const taxIdentity = await getTenantTaxIdentity(doc.id)
  return normalizeTenant(data, taxIdentity)
}
