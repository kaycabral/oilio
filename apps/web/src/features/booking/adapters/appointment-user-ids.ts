// Resolves the `customerUserId` / `professionalUserId` denormalized FKs we
// stamp on every Appointment write — the duplication that powers
// CollectionGroup history queries (#832, see Wiki § Visibilidade de histórico).
//
// Both fields are read straight from the source-of-truth (`Customer.userId`
// and `Professional.userId`) at write time. We never accept them from
// caller-supplied form data, so the data path can't drift out of sync.

import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'

// Minimal projections — only the FK each side needs to denormalize.
const CustomerUserIdProbe = Schema.Struct({ userId: Schema.optional(Schema.String) })
const ProfessionalUserIdProbe = Schema.Struct({
  userId: Schema.optional(Schema.NullOr(Schema.String)),
})

export type ResolvedAppointmentUserIds = {
  customerUserId: string
  professionalUserId: string | null
}

type Resolution = { ok: true; ids: ResolvedAppointmentUserIds } | { ok: false; error: string }

export async function resolveAppointmentUserIds(
  tenantId: string,
  customerId: string,
  professionalId: string,
): Promise<Resolution> {
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)
  const [customerSnap, professionalSnap] = await Promise.all([
    tenantRef
      .collection('customers')
      .doc(customerId)
      .withConverter(fsConverter(CustomerUserIdProbe))
      .get(),
    tenantRef
      .collection('professionals')
      .doc(professionalId)
      .withConverter(fsConverter(ProfessionalUserIdProbe))
      .get(),
  ])

  if (!customerSnap.exists) return { ok: false, error: 'Cliente não encontrado' }
  if (!professionalSnap.exists) return { ok: false, error: 'Profissional não encontrado' }

  const customerUserId = customerSnap.data()?.userId
  if (!customerUserId) {
    // Defensive: every Customer is created via `upsertCustomerWithUser`
    // which guarantees a userId. Surface the inconsistency instead of
    // writing an Appointment with an empty key.
    return { ok: false, error: 'Customer sem userId — schema inconsistente' }
  }

  const professionalUserId = professionalSnap.data()?.userId ?? null

  return { ok: true, ids: { customerUserId, professionalUserId } }
}
