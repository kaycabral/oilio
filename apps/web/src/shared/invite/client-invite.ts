import {
  type Attribution,
  type AttributionIntent,
  attributionToSearchParams,
  normalizeBrazilMobile,
} from '@/domain'

// Functional core for the contextual client invite (brief 0077, Grupo B — AC-05/
// AC-06). The establishment hands out a LINK (or QR) instead of typing a
// customer's PII: the link carries the org context + attribution and the customer
// materializes their own account on the other side (login → complete → Customer).
//
// Pure: builds RELATIVE paths + the wa.me message. The absolute base URL is
// resolved by the caller (RSC reads request headers; the action reads env) exactly
// like `UnitBookingQr.resolveBaseUrl` — the core never touches I/O.

// What the establishment chose to pre-fill on a BOOKING-intent invite. Absent for
// a plain SIGNUP invite (the customer picks service/slot themselves).
export type BookingContext = {
  unitSlug: string
  serviceId: string
  memberOperationId: string
  // ISO UTC instant of the chosen slot. A static QR's slot expires — the booking
  // page re-validates and bounces to availability if it's past (AC-07).
  startAtIso: string
}

export type ClientInviteInput = {
  orgSlug: string
  intent: AttributionIntent
  attribution: Attribution
  // The unit the invite is for (signup intent): the recepcionista picks it when
  // inviting, so the customer lands on THAT unit's booking after completing the
  // profile (they came through a specific unit's invite — that's where they want
  // to book). Carried as a slug (the public surface is slug-based; ids stay in
  // persistence/analytics). Absent → org-level signup with no unit preference.
  unitSlug?: string
  // Present only for `intent: 'booking'`.
  booking?: BookingContext
}

// The relative target path for the invite, with org context + attribution baked
// into the query string. `signup` → the platform signup carrying `?from={slug}`
// (+ optional `unit={unitSlug}` so completion routes to that unit's booking)
// + attribution; `booking` → the unit wizard's confirm step with service/pro/
// slot locked, + attribution.
export function buildClientInvitePath(input: ClientInviteInput): string {
  const params = attributionToSearchParams(input.attribution)

  if (input.intent === 'booking' && input.booking) {
    const { unitSlug, serviceId, memberOperationId, startAtIso } = input.booking
    params.set('service', serviceId)
    params.set('memberOperation', memberOperationId)
    params.set('start', startAtIso)
    return `/${input.orgSlug}/${unitSlug}/book?${params.toString()}`
  }

  // Signup intent (default): platform signup with org attribution. `from` is what
  // the existing `/signup` flow reads to materialize the Customer; `unit` (when
  // present) is what routes completion to that unit's booking screen.
  params.set('from', input.orgSlug)
  if (input.unitSlug) params.set('unit', input.unitSlug)
  return `/signup?${params.toString()}`
}

// Absolute URL = base + path. Base is `https://host` with no trailing slash
// (caller's contract), path is the leading-slash relative target above.
export function buildClientInviteUrl(baseUrl: string, input: ClientInviteInput): string {
  return `${baseUrl}${buildClientInvitePath(input)}`
}

// The pre-canned WhatsApp message the recepcionista sends. Interpolates the org
// name + the invite URL; no customer PII (the recep only knows the number).
export function buildClientInviteMessage(orgName: string, inviteUrl: string): string {
  return (
    `Olá! Aqui é da ${orgName}. ` +
    `Pra concluir seu cadastro e agendar, é só acessar: ${inviteUrl}`
  )
}

export type ClientInviteWhatsappResult =
  | { ok: true; whatsapp: string; href: string; url: string }
  | { ok: false; error: string }

// Build the full wa.me deep-link for a contextual invite: normalizes the recep's
// typed number, builds the contextual URL, and pre-fills the message. Returns an
// error result when the number can't be normalized — the UI hides the affordance
// instead of generating a broken link. NO Customer is created here (AC-05).
export function buildClientInviteWhatsapp(args: {
  rawPhone: string
  baseUrl: string
  orgName: string
  invite: ClientInviteInput
}): ClientInviteWhatsappResult {
  // The invitee's number is a person's mobile — enforce the strict BR mobile
  // (9th digit) before building the wa.me link (brief 0087).
  const whatsapp = normalizeBrazilMobile(args.rawPhone)
  if (!whatsapp) return { ok: false, error: 'Celular inválido' }
  const url = buildClientInviteUrl(args.baseUrl, args.invite)
  const message = buildClientInviteMessage(args.orgName, url)
  const href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
  return { ok: true, whatsapp, href, url }
}
