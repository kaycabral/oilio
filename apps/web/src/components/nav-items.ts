import { canManageTenant, type Membership } from '@/domain'
import type { NavItem, NavSection } from '@cbrl/design'
import {
  BarChart3,
  Building,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Lock,
  PackageOpen,
  Receipt,
  Repeat,
  ShieldCheck,
  Store,
  Target,
  UserCog,
  Users,
} from 'lucide-react'

// Minimum capability a nav entry requires to be shown (brief 0029, AC-08).
// `manageTenant` gates tenant-admin surfaces (Configuração) and the
// financeiro-admin item (Relatórios) — receptionists do not see
// them. `undefined` = visible to every member of the tenant. Resolved against
// the membership role via the canonical RBAC helpers in `@/domain`
// (never branch on `role` here directly).
type NavCapability = 'manageTenant'

// SPIKE (hours mode): per-tenant facts that gate a nav entry, resolved at
// request time (not from membership or a global flag). `usesAgenda` = the tenant
// has ≥1 unit in 'appointment' hours mode — drives whether the Agenda surface
// shows. Multi-vertical: a retail-only tenant (no appointment units) loses it.
type NavTenantSignal = 'usesAgenda'
export type NavTenantSignals = { usesAgenda: boolean }

type GatedNavItem = NavItem & {
  requires?: NavCapability
  requiresTenant?: NavTenantSignal
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
        requiresTenant: 'usesAgenda',
      },
      // Sidebar lands these pre-filtered on the open items (the list's own
      // default is the neutral "all"); `isActive` matches on the path, so the
      // entry stays highlighted on any `?status=` (or none).
      { href: '/orders?status=open', label: 'Vendas', icon: Receipt, match: 'prefix' },
      {
        href: '/subscriptions?status=open',
        label: 'Assinaturas',
        icon: CreditCard,
        match: 'prefix',
      },
      {
        href: '/reports',
        label: 'Relatórios',
        icon: BarChart3,
        match: 'prefix',
        requires: 'manageTenant',
      },
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, match: 'prefix' },
      {
        href: '/copilot',
        label: 'Copiloto',
        icon: Target,
        match: 'prefix',
        requires: 'manageTenant',
      },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { href: '/customers', label: 'Clientes', icon: Users, match: 'prefix' },
      { href: '/catalog', label: 'Catálogo', icon: PackageOpen, match: 'prefix' },
      { href: '/plans', label: 'Planos', icon: Repeat, match: 'prefix' },
    ],
  },
  {
    label: 'Configuração',
    items: [
      {
        href: '/units',
        label: 'Unidades',
        icon: Store,
        match: 'prefix',
        requires: 'manageTenant',
      },
      {
        href: '/team',
        label: 'Equipe',
        icon: ShieldCheck,
        match: 'prefix',
        requires: 'manageTenant',
      },
      {
        href: '/company',
        label: 'Empresa',
        icon: Building,
        match: 'prefix',
        requires: 'manageTenant',
      },
    ],
  },
  {
    // Personal account surfaces — visible to every member regardless of role.
    // Meu perfil is self-service rectification (brief 0032, AC-06) and
    // Privacidade is self-service erasure (AC-07); both are kept out of the
    // admin-only Configuração section so receptionists still see them without
    // gaining tenant-admin links.
    label: 'Conta',
    items: [
      { href: '/settings/profile', label: 'Perfil', icon: UserCog, match: 'prefix' },
      { href: '/settings/privacy', label: 'Privacidade', icon: Lock, match: 'prefix' },
    ],
  },
]

function hasCapability(membership: Membership, capability: NavCapability): boolean {
  switch (capability) {
    case 'manageTenant':
      return canManageTenant(membership.role)
  }
}

function canSeeItem(
  membership: Membership,
  signals: NavTenantSignals,
  item: GatedNavItem,
): boolean {
  if (item.requiresTenant === 'usesAgenda' && !signals.usesAgenda) return false
  return item.requires === undefined || hasCapability(membership, item.requires)
}

// Builds the sidebar sections visible to a given membership (brief 0029,
// AC-08). Items are filtered by their declared `requires` capability and
// sections that end up empty are dropped — so a receptionist loses the whole
// Configuração section plus the financeiro-admin items, while owner/manager
// see everything.
export function getNavSections(membership: Membership, signals: NavTenantSignals): NavSection[] {
  return ALL_NAV_SECTIONS.flatMap((section) => {
    const items = section.items
      .filter((item) => canSeeItem(membership, signals, item))
      .map(({ requires: _requires, ...item }) => item)
    if (items.length === 0) return []
    return [{ label: section.label, items }]
  })
}
