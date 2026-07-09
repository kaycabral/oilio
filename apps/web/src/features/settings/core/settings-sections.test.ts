import { describe, expect, it } from 'vitest'

import {
  SETTINGS_SECTIONS,
  settingsSectionMeta,
  toSettingsSectionKey,
  visibleSettingsSections,
} from './settings-sections'

describe('visibleSettingsSections', () => {
  it('shows every section to a role that manages the org', () => {
    for (const role of ['owner', 'manager'] as const) {
      const keys = visibleSettingsSections(role).map((s) => s.key)
      expect(keys).toEqual(['profile', 'billing', 'notifications', 'privacy'])
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

  it('keeps the nav order (Privacidade last) and pt-BR labels over English routes', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Perfil',
      'Cobrança',
      'Notificações',
      'Privacidade',
    ])
    expect(SETTINGS_SECTIONS.map((s) => s.href)).toEqual([
      '/settings/profile',
      '/settings/billing',
      '/settings/notifications',
      '/settings/privacy',
    ])
  })
})

describe('toSettingsSectionKey', () => {
  it('returns the matching key for a known section', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(toSettingsSectionKey(section.key)).toEqual(section.key)
    }
  })

  it('returns null for an unknown or missing segment', () => {
    expect(toSettingsSectionKey('unknown')).toBeNull()
    expect(toSettingsSectionKey('')).toBeNull()
    expect(toSettingsSectionKey(null)).toBeNull()
  })
})

describe('settingsSectionMeta', () => {
  it('returns a label and description for every section', () => {
    for (const section of SETTINGS_SECTIONS) {
      const meta = settingsSectionMeta(section.key)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })

  it('is the same object referenced in SETTINGS_SECTIONS', () => {
    expect(settingsSectionMeta('billing').label).toEqual('Cobrança')
  })
})
