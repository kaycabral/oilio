import type { Role } from '@/domain'
import { canManageOrg } from '@/domain'

// The Configurações modal sections (brief 0090). Routes are the canonical
// English `/settings/*` paths; the labels shown to the user are pt-BR. Nav order
// (approved prototype + owner tweak): Perfil · Cobrança · Notificações ·
// Privacidade — Privacidade sits last (a rarely-used LGPD surface). Perfil is
// the default section, available to every member.
export type SettingsSectionKey = 'profile' | 'privacy' | 'billing' | 'notifications'

export type SettingsSection = {
  key: SettingsSectionKey
  href: string
  // The nav item label. Also used verbatim as the section header title, so the
  // dialog/page heading always matches the menu item the user clicked.
  label: string
  // One-line supporting text under the header (kept short so it never wraps).
  // Single source of truth: the full page and the modal header both read it.
  description: string
  // When true the section is management-only: it disappears from the modal nav
  // for a member without `manageOrg` (receptionist sees only Perfil/Privacidade).
  requiresManage: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'profile',
    href: '/settings/profile',
    label: 'Perfil',
    description: 'Seus dados pessoais, usados em todas as telas.',
    requiresManage: false,
  },
  {
    key: 'billing',
    href: '/settings/billing',
    label: 'Cobrança',
    description: 'Seu plano, unidades cobradas e assinatura do Oilio.',
    requiresManage: true,
  },
  {
    key: 'notifications',
    href: '/settings/notifications',
    label: 'Notificações',
    description: 'As mensagens automáticas enviadas por WhatsApp.',
    requiresManage: true,
  },
  {
    key: 'privacy',
    href: '/settings/privacy',
    label: 'Privacidade',
    description: 'Seus direitos de dados (LGPD): exportar e excluir.',
    requiresManage: false,
  },
]

// Lookup the section metadata by key. Used by the full-page header and the modal
// header so both render identical title + description.
export function settingsSectionMeta(key: SettingsSectionKey): SettingsSection {
  const meta = SETTINGS_SECTIONS.find((section) => section.key === key)
  // Every SettingsSectionKey has an entry above; this is a total lookup.
  if (!meta) throw new Error(`unknown settings section: ${key}`)
  return meta
}

// Narrows an arbitrary string (a route param / selected slot segment) to a known
// section key without an unsafe cast — the matched entry's own `key` carries the
// literal type. Returns null for anything unknown so the caller can 404.
export function toSettingsSectionKey(value: string | null): SettingsSectionKey | null {
  return SETTINGS_SECTIONS.find((section) => section.key === value)?.key ?? null
}

// The sections visible in the modal nav for a given role. Cobrança (manageOrg)
// and Notificações (canManage) are hidden from members who don't manage the org,
// mirroring the sidebar hide posture (brief 0088). The route pages keep their own
// server guard — this only trims what the nav offers (defense in depth).
export function visibleSettingsSections(role: Role): SettingsSection[] {
  const canManage = canManageOrg(role)
  return SETTINGS_SECTIONS.filter((section) => !section.requiresManage || canManage)
}
