import type { Role } from '@/domain'
import { canManageOrg } from '@/domain'

// The Configurações modal sections (brief 0090). Routes are the canonical
// English `/settings/*` paths; the labels shown to the user are pt-BR. Order is
// the flat list of the approved prototype: Perfil · Privacidade · Cobrança ·
// Notificações. Perfil is the default section (available to every member).
export type SettingsSectionKey = 'profile' | 'privacy' | 'billing' | 'notifications'

export type SettingsSection = {
  key: SettingsSectionKey
  href: string
  label: string
  // When true the section is management-only: it disappears from the modal nav
  // for a member without `manageOrg` (receptionist sees only Perfil/Privacidade).
  requiresManage: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { key: 'profile', href: '/settings/profile', label: 'Perfil', requiresManage: false },
  { key: 'privacy', href: '/settings/privacy', label: 'Privacidade', requiresManage: false },
  { key: 'billing', href: '/settings/billing', label: 'Cobrança', requiresManage: true },
  {
    key: 'notifications',
    href: '/settings/notifications',
    label: 'Notificações',
    requiresManage: true,
  },
]

// The sections visible in the modal nav for a given role. Cobrança (manageOrg)
// and Notificações (canManage) are hidden from members who don't manage the org,
// mirroring the sidebar hide posture (brief 0088). The route pages keep their own
// server guard — this only trims what the nav offers (defense in depth).
export function visibleSettingsSections(role: Role): SettingsSection[] {
  const canManage = canManageOrg(role)
  return SETTINGS_SECTIONS.filter((section) => !section.requiresManage || canManage)
}
