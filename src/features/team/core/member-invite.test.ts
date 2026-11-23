import { describe, expect, it } from 'vitest'
import { buildMemberInviteMessage, buildMemberInviteWhatsapp } from './member-invite'

describe('buildMemberInviteWhatsapp', () => {
  const inviteLink = 'https://app.oilio.test/invites/org-1/inv-1?token=raw'

  it('normalizes the number and builds the wa.me deep-link (AC-01/AC-03)', () => {
    const res = buildMemberInviteWhatsapp({
      rawPhone: '(11) 90000-0000',
      orgName: 'Barbearia X',
      inviteLink,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.whatsapp).toBe('5511900000000')
    expect(res.href.startsWith('https://wa.me/5511900000000?text=')).toBe(true)
    expect(decodeURIComponent(res.href)).toContain(inviteLink)
    expect(decodeURIComponent(res.href)).toContain('Barbearia X')
  })

  it('fails cleanly on an unnormalizable number so the UI hides the affordance', () => {
    const res = buildMemberInviteWhatsapp({ rawPhone: 'abc', orgName: 'X', inviteLink })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/WhatsApp/i)
  })
})

describe('buildMemberInviteMessage', () => {
  it('names the org + carries the accept link, no invitee PII', () => {
    const msg = buildMemberInviteMessage('Salão Y', 'https://x/invites/o/i?token=t')
    expect(msg).toContain('Salão Y')
    expect(msg).toContain('https://x/invites/o/i?token=t')
    expect(msg).toContain('Google')
  })
})
