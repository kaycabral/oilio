import { canManageOrg, type Membership } from '@/domain'
import { hasCapability as tierHasCapability, type Capability } from '@/domain/billing/capabilities'
import { type Tier } from '@/domain/billing/tiers'
import { isFeatureEnabled, type FeatureFlag } from '@/shared/flags'
import type { NavItem, NavSection } from '@oilio/design'
import {
  BarChart3,
  Building,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  PackageOpen,
  Receipt,
  Repeat,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from 'lucide-react'

type NavCapability =
  | 'manageOrg'
  | 'canManageCustomers'
  | 'canManageCatalog'
  | 'canManagePlans'
  | 'canManageSubscriptions'

type NavOrgSignal = 'usesAgenda'
export type NavOrgSignals = { usesAgenda: boolean }

type GatedNavItem = NavItem & {
  requires?: NavCapability
  requiresOrg?: NavOrgSignal
  requiresTier?: Capability
  requiresFlag?: FeatureFlag
}
type GatedNavSection = Omit<NavSection, 'items'> & { items: readonly GatedNavItem[] }

const ALL_NAV_SECTIONS: readonly GatedNavSection[] = [
  {
    label: 'Operação',
    items: [
      {
        href: '/agenda',
        label: 'Agenda',
        icon: CalendarDays,
        match: 'prefix',
        requiresOrg: 'usesAgenda',
      },
      { href: '/orders?status=open', label: 'Vendas', icon: Receipt, match: 'prefix' },
      {
        href: '/subscriptions?status=open',
        label: 'Assinaturas',
        icon: CreditCard,
        match: 'prefix',
        requires: 'canManageSubscriptions',
        requiresTier: 'plans.recurring',
      },
      {
        href: '/reports',
        label: 'Relatórios',
        icon: BarChart3,
        match: 'prefix',
        requires: 'manageOrg',
        requiresTier: 'reports.sales',
      },
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        match: 'prefix',
        requires: 'manageOrg',
      },
      {
        href: '/copilot',
        label: 'Copiloto',
        icon: Target,
        match: 'prefix',
        requires: 'manageOrg',
        requiresTier: 'copilot.profit_goal',
        requiresFlag: 'copilot',
      },
      {
        href: '/finance',
        label: 'Financeiro',
        icon: Wallet,
        match: 'prefix',
        requires: 'manageOrg',
        requiresFlag: 'finance',
      },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      {
        href: '/customers',
        label: 'Clientes',
        icon: Users,
        match: 'prefix',
        requires: 'canManageCustomers',
      },
      {
        href: '/catalog',
        label: 'Catálogo',
        icon: PackageOpen,
        match: 'prefix',
        requires: 'canManageCatalog',
      },
      {
        href: '/plans',
        label: 'Planos',
        icon: Repeat,
        match: 'prefix',
        requires: 'canManagePlans',
        requiresTier: 'plans.recurring',
      },
    ],
  },
  {
    label: 'Administração',
    items: [
      {
        href: '/organizations',
        label: 'Negócios',
        icon: Building,
        match: 'prefix',
        requires: 'manageOrg',
      },
      {
        href: '/team',
        label: 'Equipe',
        icon: ShieldCheck,
        match: 'prefix',
        requires: 'manageOrg',
      },
    ],
  },
]

function hasCapability(membership: Membership, capability: NavCapability): boolean {
  switch (capability) {
    case 'manageOrg':
      return canManageOrg(membership.role)
    case 'canManageCustomers':
    case 'canManageCatalog':
    case 'canManagePlans':
    case 'canManageSubscriptions':
      return membership.permissions[capability]
  }
}

function canSeeItem(
  membership: Membership,
  signals: NavOrgSignals,
  tier: Tier,
  item: GatedNavItem,
): boolean {
  if (item.requiresOrg === 'usesAgenda' && !signals.usesAgenda) return false
  if (item.requiresFlag !== undefined && !isFeatureEnabled(item.requiresFlag)) return false
  if (item.requiresTier !== undefined && !tierHasCapability(tier, item.requiresTier)) return false
  return item.requires === undefined || hasCapability(membership, item.requires)
}

export function getNavSections(
  membership: Membership,
  signals: NavOrgSignals,
  tier: Tier,
): NavSection[] {
  return ALL_NAV_SECTIONS.flatMap((section) => {
    const items = section.items
      .filter((item) => canSeeItem(membership, signals, tier, item))
      .map(
        ({
          requires: _requires,
          requiresTier: _requiresTier,
          requiresFlag: _requiresFlag,
          ...item
        }) => item,
      )
    if (items.length === 0) return []
    return [{ label: section.label, items }]
  })
}
