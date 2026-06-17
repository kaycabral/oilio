import { getAdminFirestore } from '@/shared/db'
import 'server-only'

// Privacy event emission — brief 0032 / #1066 (AC-07).
//
// The LGPD lifecycle emits three auditable events: `pii_erasure_requested`,
// `pii_anonymized`, `pii_rectified`. Per the canonical Event Catalog
// (Telemetria § "privacy") these events carry NO PII — only opaque refs: the
// tenant id, an opaque `subject_ref` (the global `userId` or the derived
// anonymized subject code — both opaque, never a name/contact), the `scope`,
// and `fields_changed` as field NAMES ONLY (never their values). This keeps
// the ADR 0010 invariant (PII never in an event payload, audited by
// `no-pii-in-events.test.ts`) true for the privacy domain too.
//
// Transport: the vendor-neutral product-telemetry layer (`track()`, brief
// 0026) has not shipped yet, so we use the sanctioned ownership-preserving
// fallback — a server-only Firestore `pii_events/` collection. When `track()`
// lands, this becomes one adapter behind it: the call-sites (anonymize /
// rectify) stay unchanged because they only depend on `emitPiiEvent`.

export type PiiEventName = 'pii_erasure_requested' | 'pii_anonymized' | 'pii_rectified'

// The PII-free payload shape. `subjectRef` is an OPAQUE id (userId or the
// anonymized subject code) — never a name/whatsapp/email. `fieldsChanged`
// carries field NAMES only (e.g. `displayName`), never the new values.
export type PiiEventPayload = {
  readonly tenantId: string | null
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

  const record: Record<string, unknown> = {
    event,
    tenant_id: payload.tenantId,
    subject_ref: payload.subjectRef,
    scope: payload.scope,
    ts: new Date().toISOString(),
  }
  if (payload.requestedBy !== undefined) record.requested_by = payload.requestedBy
  if (fieldsChanged.length > 0) record.fields_changed = fieldsChanged

  try {
    await getAdminFirestore().collection('pii_events').add(record)
  } catch (err) {
    console.error(`[emitPiiEvent] failed to record ${event}`, err)
  }
}
