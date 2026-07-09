import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger } from '@/shared/lib/logger'
import 'server-only'

export type PiiEventName = 'pii_erasure_requested' | 'pii_anonymized' | 'pii_rectified'

export type PiiEventPayload = {
  readonly orgId: string | null
  readonly subjectRef: string
  readonly scope: 'account'
  readonly requestedBy?: string
  readonly fieldsChanged?: readonly string[]
}

const FORBIDDEN_VALUE_MARKERS = /@|\d{6,}/

export async function emitPiiEvent(event: PiiEventName, payload: PiiEventPayload): Promise<void> {
  const fieldsChanged = (payload.fieldsChanged ?? []).filter(
    (name) => !FORBIDDEN_VALUE_MARKERS.test(name),
  )

  try {
    await getEventStorePool().query(
      `INSERT INTO pii_events (event, org_id, subject_ref, scope, requested_by, fields_changed, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event,
        payload.orgId,
        payload.subjectRef,
        payload.scope,
        payload.requestedBy ?? null,
        fieldsChanged.length > 0 ? JSON.stringify(fieldsChanged) : null,
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    logger.error('failed to record pii event', { scope: 'emitPiiEvent', event, err })
  }
}
