import {
  type Attribution,
  type AttributionIntent,
  attributionToSearchParams,
  normalizeBrazilPhone,
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
  // Present only for `intent: 'booking'`.
  booking?: BookingContext
}

// The relative target path for the invite, with org context + attribution baked
// into the query string. `signup` → the platform signup carrying `?from={slug}`
// (the existing flow) + attribution; `booking` → the unit wizard's confirm step
// with service/pro/slot locked, + attribution.
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
  // the existing `/signup` + `/signup/done` flow reads to materialize the Customer.
  params.set('from', input.orgSlug)
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
  const whatsapp = normalizeBrazilPhone(args.rawPhone)
  if (!whatsapp) return { ok: false, error: 'WhatsApp inválido' }
  const url = buildClientInviteUrl(args.baseUrl, args.invite)
  const message = buildClientInviteMessage(args.orgName, url)
  const href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
  return { ok: true, whatsapp, href, url }
}
