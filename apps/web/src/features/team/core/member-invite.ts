// Functional core for the WhatsApp member invite (brief 0084, Grupo A). The
// owner/manager hands out a token link over WhatsApp instead of typing an
// email: the establishment's real channel. Mirrors the client-invite mechanic
// (`@/shared/invite/client-invite.ts`) — same `wa.me` delivery — but for the
// member accept link (`/invites/{orgId}/{id}?token=`), NOT the client signup
// path, and WITHOUT attribution context (a member invite grants a role, not a
// customer funnel touch).
//
// Pure: normalizes the number + builds the message + the `wa.me` href. The
// absolute invite link is built by the caller (the action, which owns the
// token + base URL). The number is the DELIVERY channel, never an accept-time
// match key — the signed token + first-accept-wins is the identity binding
// (brief 0084, Grupo B).

import { normalizeBrazilMobile } from '@/domain'

export type MemberInviteWhatsappResult =
  | { ok: true; whatsapp: string; href: string }
  | { ok: false; error: string }

// The pre-canned WhatsApp message the owner sends to a prospective member.
// Interpolates the org name + the accept link; no PII beyond the number the
// owner already typed.
export function buildMemberInviteMessage(orgName: string, inviteLink: string): string {
  return (
    `Olá! Você foi convidado para a equipe da ${orgName} no oilio. ` +
    `Pra aceitar, entre com sua conta Google por aqui: ${inviteLink}`
  )
}

// Build the full `wa.me` deep-link for a member invite. Normalizes the typed
// number; returns an error result when it can't be normalized so the UI hides
// the affordance instead of generating a broken link.
export function buildMemberInviteWhatsapp(args: {
  rawPhone: string
  orgName: string
  inviteLink: string
}): MemberInviteWhatsappResult {
  const whatsapp = normalizeBrazilMobile(args.rawPhone)
  if (!whatsapp) return { ok: false, error: 'WhatsApp inválido' }
  const message = buildMemberInviteMessage(args.orgName, args.inviteLink)
  const href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`
  return { ok: true, whatsapp, href }
}
