import type { Attribution } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  buildClientInviteMessage,
  buildClientInvitePath,
  buildClientInviteUrl,
  buildClientInviteWhatsapp,
} from './client-invite'

const ATTR: Attribution = {
  source: 'whatsapp',
  medium: 'invite',
  campaign: null,
  content: null,
  term: null,
  actorId: 'recep-1',
  intent: 'signup',
}

describe('buildClientInvitePath', () => {
  it('builds a signup invite carrying from + attribution', () => {
    const path = buildClientInvitePath({ orgSlug: 'salao-x', intent: 'signup', attribution: ATTR })
    const url = new URL(`https://h${path}`)
    expect(url.pathname).toBe('/signup')
    expect(url.searchParams.get('from')).toBe('salao-x')
    // Marketing axes emit the standard utm_* names; actor/intent have no UTM
    // equivalent and keep the cbrl_ namespace.
    expect(url.searchParams.get('utm_source')).toBe('whatsapp')
    expect(url.searchParams.get('cbrl_actor')).toBe('recep-1')
    expect(url.searchParams.get('cbrl_intent')).toBe('signup')
  })

  it('carries the unit slug on a signup invite so completion routes to that unit', () => {
    const path = buildClientInvitePath({
      orgSlug: 'salao-x',
      unitSlug: 'centro',
      intent: 'signup',
      attribution: ATTR,
    })
    const url = new URL(`https://h${path}`)
    expect(url.pathname).toBe('/signup')
    expect(url.searchParams.get('from')).toBe('salao-x')
    expect(url.searchParams.get('unit')).toBe('centro')
  })

  it('omits unit when none is given (org-only signup invite)', () => {
    const path = buildClientInvitePath({ orgSlug: 'salao-x', intent: 'signup', attribution: ATTR })
    expect(new URL(`https://h${path}`).searchParams.get('unit')).toBeNull()
  })

  it('builds a booking invite with service/pro/slot locked', () => {
    const path = buildClientInvitePath({
      orgSlug: 'salao-x',
      intent: 'booking',
      attribution: { ...ATTR, intent: 'booking' },
      booking: {
        unitSlug: 'centro',
        serviceId: 'svc-1',
        memberOperationId: 'mo-1',
        startAtIso: '2026-07-01T13:00:00.000Z',
      },
    })
    const url = new URL(`https://h${path}`)
    expect(url.pathname).toBe('/salao-x/centro/book')
    expect(url.searchParams.get('service')).toBe('svc-1')
    expect(url.searchParams.get('memberOperation')).toBe('mo-1')
    expect(url.searchParams.get('start')).toBe('2026-07-01T13:00:00.000Z')
    expect(url.searchParams.get('cbrl_intent')).toBe('booking')
  })

  it('falls back to signup when intent=booking but no booking context', () => {
    const path = buildClientInvitePath({
      orgSlug: 'salao-x',
      intent: 'booking',
      attribution: { ...ATTR, intent: 'booking' },
    })
    expect(new URL(`https://h${path}`).pathname).toBe('/signup')
  })
})

describe('buildClientInviteUrl', () => {
  it('prefixes the base URL with no extra slash', () => {
    const url = buildClientInviteUrl('https://oilio.app', {
      orgSlug: 'salao-x',
      intent: 'signup',
      attribution: ATTR,
    })
    expect(url.startsWith('https://oilio.app/signup?')).toBe(true)
  })
})

describe('buildClientInviteMessage', () => {
  it('interpolates org name + url, no customer PII', () => {
    const msg = buildClientInviteMessage('Salão X', 'https://oilio.app/signup?from=salao-x')
    expect(msg).toContain('Salão X')
    expect(msg).toContain('https://oilio.app/signup?from=salao-x')
  })
})

describe('buildClientInviteWhatsapp', () => {
  const invite = {
    orgSlug: 'salao-x',
    intent: 'signup' as const,
    attribution: ATTR,
  }

  it('normalizes the number and builds a wa.me deep link', () => {
    const res = buildClientInviteWhatsapp({
      rawPhone: '(11) 98888-7777',
      baseUrl: 'https://oilio.app',
      orgName: 'Salão X',
      invite,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.whatsapp).toBe('5511988887777')
    expect(res.href.startsWith('https://wa.me/5511988887777?text=')).toBe(true)
    expect(decodeURIComponent(res.href)).toContain('https://oilio.app/signup?')
    expect(res.url.startsWith('https://oilio.app/signup?')).toBe(true)
  })

  it('returns an error for an unnormalizable number (no broken link)', () => {
    const res = buildClientInviteWhatsapp({
      rawPhone: 'abc',
      baseUrl: 'https://oilio.app',
      orgName: 'Salão X',
      invite,
    })
    expect(res).toEqual({ ok: false, error: 'Celular inválido' })
  })
})
