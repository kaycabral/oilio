import { normalizeBrazilMobile, whatsappUrl } from '@cbrl/br/phone'

export type MemberInviteWhatsappResult =
  { ok: true; whatsapp: string; href: string } | { ok: false; error: string }

export function buildMemberInviteMessage(orgName: string, inviteLink: string): string {
  return (
    `Olá! Você foi convidado para a equipe da ${orgName} no oilio. ` +
    `Pra aceitar, entre com sua conta Google por aqui: ${inviteLink}`
  )
}

export function buildMemberInviteWhatsapp(args: {
  rawPhone: string
  orgName: string
  inviteLink: string
}): MemberInviteWhatsappResult {
  const whatsapp = normalizeBrazilMobile(args.rawPhone)
  if (!whatsapp) return { ok: false, error: 'WhatsApp inválido' }
  const message = buildMemberInviteMessage(args.orgName, args.inviteLink)
  const href = whatsappUrl(whatsapp, message)
  if (!href) return { ok: false, error: 'WhatsApp inválido' }
  return { ok: true, whatsapp, href }
}
