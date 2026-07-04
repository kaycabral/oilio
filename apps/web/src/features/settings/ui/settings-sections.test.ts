import { describe, expect, it } from 'vitest'

import { SETTINGS_SECTIONS, visibleSettingsSections } from './settings-sections'

// The Configurações modal nav is gated by role (brief 0090): Cobrança and
// Notificações are management-only, so a member without `manageOrg` sees only
// the personal sections. The route pages keep their own server guard — this
// trims the nav (defense in depth).
describe('visibleSettingsSections', () => {
  it('shows every section to a role that manages the org', () => {
    for (const role of ['owner', 'manager'] as const) {
      const keys = visibleSettingsSections(role).map((s) => s.key)
      expect(keys).toEqual(['profile', 'privacy', 'billing', 'notifications'])
    }
  })

  it('hides Cobrança + Notificações from a non-managing role', () => {
    for (const role of ['receptionist', 'member_operator'] as const) {
      const keys = visibleSettingsSections(role).map((s) => s.key)
      expect(keys).toEqual(['profile', 'privacy'])
      expect(keys).not.toContain('billing')
      expect(keys).not.toContain('notifications')
    }
  })

  it('keeps the flat prototype order and pt-BR labels over English routes', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Perfil',
      'Privacidade',
      'Cobrança',
      'Notificações',
    ])
    expect(SETTINGS_SECTIONS.map((s) => s.href)).toEqual([
      '/settings/profile',
      '/settings/privacy',
      '/settings/billing',
      '/settings/notifications',
    ])
  })
})
