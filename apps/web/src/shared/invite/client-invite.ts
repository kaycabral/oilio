import {
  type Attribution,
  type AttributionIntent,
  attributionToSearchParams,
  normalizeBrazilMobile,
} from '@/domain'

export type BookingContext = {
  unitSlug: string
  serviceId: string
  memberOperationId: string
  startAtIso: string
}

export type ClientInviteInput = {
  orgSlug: string
  intent: AttributionIntent
  attribution: Attribution
  unitSlug?: string
  booking?: BookingContext
}

export function buildClientInvitePath(input: ClientInviteInput): string {
  const params = attributionToSearchParams(input.attribution)

  if (input.intent === 'booking' && input.booking) {
    const { unitSlug, serviceId, memberOperationId, startAtIso } = input.booking
    params.set('service', serviceId)
    params.set('memberOperation', memberOperationId)
    params.set('start', startAtIso)
    return `/${input.orgSlug}/${unitSlug}/book?${params.toString()}`
  }

  params.set('from', input.orgSlug)
  if (input.unitSlug) params.set('unit', input.unitSlug)
  return `/signup?${params.toString()}`
}

export function buildClientInviteUrl(baseUrl: string, input: ClientInviteInput): string {
  return `${baseUrl}${buildClientInvitePath(input)}`
}

export function buildClientInviteMessage(orgName: string, inviteUrl: string): string {
  return (
    `Olá! Aqui é da ${orgName}. ` +
    `Pra concluir seu cadastro e agendar, é só acessar: ${inviteUrl}`
  )
}

export type ClientInviteWhatsappResult =
  { ok: true; whatsapp: string; href: string; url: string } | { ok: false; error: string }

export function buildClientInviteWhatsapp(args: {
  rawPhone: string
  baseUrl: string
  orgName: string
  invite: ClientInviteInput
}): ClientInviteWhatsappResult {
  const whatsapp = normalizeBrazilMobile(args.rawPhone)
  if (!whatsapp) return { ok: false, error: 'Celular inválido' }
  const url = buildClientInviteUrl(args.baseUrl, args.invite)
  const message = buildClientInviteMessage(args.orgName, url)
  const href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
  return { ok: true, whatsapp, href, url }
}
