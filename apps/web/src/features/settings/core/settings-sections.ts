import type { Role } from '@/domain'
import { canManageOrg } from '@/domain'

export type SettingsSectionKey = 'profile' | 'privacy' | 'billing' | 'notifications'

export type SettingsSection = {
  key: SettingsSectionKey
  href: string
  label: string
  description: string
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

export function settingsSectionMeta(key: SettingsSectionKey): SettingsSection {
  const meta = SETTINGS_SECTIONS.find((section) => section.key === key)
  if (!meta) throw new Error(`unknown settings section: ${key}`)
  return meta
}

export function toSettingsSectionKey(value: string | null): SettingsSectionKey | null {
  return SETTINGS_SECTIONS.find((section) => section.key === value)?.key ?? null
}

export const SETTINGS_HASH_PREFIX = '#settings/'

export function settingsHash(section: SettingsSectionKey): string {
  return `${SETTINGS_HASH_PREFIX}${section}`
}

export function visibleSettingsSections(role: Role): SettingsSection[] {
  const canManage = canManageOrg(role)
  return SETTINGS_SECTIONS.filter((section) => !section.requiresManage || canManage)
}
