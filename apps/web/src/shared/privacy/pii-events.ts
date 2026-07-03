import { getEventStorePool } from '@/shared/db/pg/pool'
import { logger } from '@/shared/lib/logger'
import 'server-only'

// Privacy event emission — brief 0032 / #1066 (AC-07).
//
// The LGPD lifecycle emits three auditable events: `pii_erasure_requested`,
// `pii_anonymized`, `pii_rectified`. Per the canonical Event Catalog
// (Telemetria § "privacy") these events carry NO PII — only opaque refs: the
// org id, an opaque `subject_ref` (the global `userId` or the derived
// anonymized subject code — both opaque, never a name/contact), the `scope`,
// and `fields_changed` as field NAMES ONLY (never their values). This keeps
// the ADR 0010 invariant (PII never in an event payload, audited by
// `no-pii-in-events.test.ts`) true for the privacy domain too.
//
// Transport (post-cutover, brief 0062): an append-only `pii_events` table in the
// Postgres event store — the last Firestore-backed sink moved to the single
// backend. When the vendor-neutral product-telemetry layer (`track()`, brief
// 0026) lands, this becomes one adapter behind it: the call-sites (anonymize /
// rectify) stay unchanged because they only depend on `emitPiiEvent`.

export type PiiEventName = 'pii_erasure_requested' | 'pii_anonymized' | 'pii_rectified'

// The PII-free payload shape. `subjectRef` is an OPAQUE id (userId or the
// anonymized subject code) — never a name/whatsapp/email. `fieldsChanged`
// carries field NAMES only (e.g. `displayName`), never the new values.
export type PiiEventPayload = {
  readonly orgId: string | null
  readonly subjectRef: string
  readonly scope: 'account'
  readonly requestedBy?: string
  readonly fieldsChanged?: readonly string[]
}

// Field names that must never appear as a `fieldsChanged` entry — those are
// PII VALUES, not names. We allow the field name (`displayName`) but reject any
// entry that looks like an actual value leaked in. Defense-in-depth against a
// caller passing values instead of names.
const FORBIDDEN_VALUE_MARKERS = /@|\d{6,}/

// Emits a privacy event with a PII-free payload. Server-only; best-effort —
// telemetry must never trap the user mid-erasure/rectification, so a write
// failure is logged and swallowed (the domain mutation already committed).
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
