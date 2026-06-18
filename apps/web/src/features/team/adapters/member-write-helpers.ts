// Internal write/saga helpers for the team member actions — extracted from the
// 'use server' module to stay under the module-size gate. Not server actions
// (never form-invoked); imperative-shell helpers the actions compose. All
// return `string | null` (error | success), so no result-type cycle.

import { CatalogItem, isCatalogService, StoredProfessional, User } from '@/domain'
import { deriveOperationalStatus, ProfessionalConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'

import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'

import { deleteProfessionalPii, writeProfessionalPii } from '@/shared/org/professional-read'

// Identity (name/whatsapp/email) is NOT parsed here (#1046 / brief 0028
// AC-04/AC-05): it derives live from `users/{userId}`. The operational edit
// form only carries professional-scoped fields + `taxIdentity`.
// `operationalStatus` is NOT parsed here (#1047 / brief 0028 AC-06): it is DERIVED
// from real facts and emitted as a domain event, never written by a UI input.
// Validates the #876 invariant: every `serviceId` in the pro's list must
// belong to a service whose `unitIds` intersects the pro's `unitIds`. A
// service the pro doesn't share any unit with would be unreachable on the
// agenda — reject before the write. Returns null on success, an error
// message on the first invalid serviceId. Reads the unified catalog (brief
// 0023, #1004): serviceIds are FKs into `catalog_items` of kind service.
export async function validateServiceUnitIntersection(
  orgId: string,
  serviceIds: string[],
  proUnitIds: string[],
): Promise<string | null> {
  if (serviceIds.length === 0) return null
  const db = getAdminFirestore()
  const proUnitSet = new Set(proUnitIds)
  for (const sid of serviceIds) {
    const snap = await db
      .collection('orgs')
      .doc(orgId)
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(sid)
      .get()
    const item = snap.data()
    if (!item) return `Serviço ${sid} não encontrado`
    if (!isCatalogService(item)) return `Item ${sid} não é um serviço`
    const sharedUnit = (item.unitIds ?? []).some((u) => proUnitSet.has(u))
    if (!sharedUnit) {
      return `Serviço "${item.name}" não compartilha nenhuma unidade com o profissional.`
    }
  }
  return null
}

// Re-derives `operationalStatus` from real facts and emits the transition event
// when it crosses (#1047 / AC-07). The professional projection existing implies
// the invite was accepted (#1045). Reads the linked User's whatsapp (live
// identity, #1046) + the current projected status, then emits
// `professional.activated` / `professional.suspended` only when the derived
// status differs from the current one. Returns an error message on failure,
// null on success or no-op.
export async function reconcileApproval({
  orgId,
  professionalId,
  actorId,
  unitIds,
  serviceIds,
}: {
  orgId: string
  professionalId: string
  actorId: string
  unitIds: string[]
  serviceIds: string[]
}): Promise<string | null> {
  const db = getAdminFirestore()
  const proRef = db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .withConverter(fsConverter(StoredProfessional))
    .doc(professionalId)
  const proSnap = await proRef.get()
  const stored = proSnap.data()
  if (!stored) return null
  const userSnap = await db
    .collection('users')
    .withConverter(fsConverter(User))
    .doc(stored.userId)
    .get()
  const user = userSnap.data()

  const derived = deriveOperationalStatus({
    inviteAccepted: true,
    whatsapp: user?.whatsapp ?? null,
    unitIds,
    serviceIds,
  })
  const wasOperational = stored.operationalStatus === 'operational'
  const shouldOperate = derived === 'operational'
  if (shouldOperate === wasOperational) return null
  const transition = shouldOperate ? 'professional.activated' : 'professional.suspended'
  const result = await emitEvent(
    ProfessionalConfig,
    `orgs/${orgId}/professionals/${professionalId}`,
    { _tag: transition, actorId, payload: {} },
  )
  return result.ok ? null : result.error
}

// Step 2 of a role change — reconcile the professional projection to the new
// role (≤1 projection per userId per org). Promotion materializes or
// re-derives approval; demotion suspends (never deletes — history preserved,
// reversible). Any failure runs `compensateRole` and returns the error message;
// returns null on success.
export async function syncProfessionalProjection(args: {
  db: ReturnType<typeof getAdminFirestore>
  orgId: string
  actorId: string
  targetUserId: string
  willBeProfessional: boolean
  wasProfessional: boolean
  compensateRole: () => Promise<void>
}): Promise<string | null> {
  const { db, orgId, actorId, targetUserId, willBeProfessional, wasProfessional } = args
  const proSnap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('professionals')
    .where('userId', '==', targetUserId)
    .limit(1)
    .withConverter(fsConverter(StoredProfessional))
    .get()
  const existingPro = proSnap.docs[0]

  if (willBeProfessional && existingPro) {
    // Re-promotion: re-derive whether it operates (suspended → approved iff the
    // profile is complete — AC-05 reversible).
    const stored = existingPro.data()
    const reErr = await reconcileApproval({
      orgId,
      professionalId: existingPro.id,
      actorId,
      unitIds: stored?.unitIds ?? [],
      serviceIds: stored?.serviceIds ?? [],
    })
    if (reErr) {
      await args.compensateRole()
      return reErr
    }
    return null
  }

  if (willBeProfessional) {
    // Materialize via the 0028 `professional.created` path, linked to `userId`.
    // Empty units/services, approval `none` (off the public agenda until the
    // profile completes), PII doc starts with null taxIdentity. Identity derives
    // live from the User (#1046).
    const now = new Date().toISOString()
    const proRef = db.collection('orgs').doc(orgId).collection('professionals').doc()
    const stored: StoredProfessional = {
      id: proRef.id,
      orgId,
      userId: targetUserId,
      operationalStatus: 'incomplete',
      defaultCommission: null,
      unitIds: [],
      serviceIds: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeProfessionalPii(orgId, proRef.id, { taxIdentity: null })
    const proCreated = await emitEvent(
      ProfessionalConfig,
      `orgs/${orgId}/professionals/${proRef.id}`,
      { _tag: 'professional.created', actorId, payload: { data: stored } },
    )
    if (!proCreated.ok) {
      await args.compensateRole()
      await proRef.delete().catch(() => undefined)
      await deleteProfessionalPii(orgId, proRef.id)
      return proCreated.error
    }
    return null
  }

  if (wasProfessional && existingPro) {
    // Demotion — DEACTIVATE the projection so it drops off the public agenda/
    // catalog (AC-04/AC-05). `professional.suspended` projects approval→`pending`;
    // `isOperational` keys only on `approved`. Reversible, history kept.
    const suspended = await emitEvent(
      ProfessionalConfig,
      `orgs/${orgId}/professionals/${existingPro.id}`,
      { _tag: 'professional.suspended', actorId, payload: {} },
    )
    if (!suspended.ok) {
      await args.compensateRole()
      return suspended.error
    }
  }

  return null
}
