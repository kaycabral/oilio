import { canManageOrg, type Membership } from '@/domain'
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
  Target,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

// Minimum capability a nav entry requires to be shown (brief 0029, AC-08).
// `manageOrg` gates org-admin surfaces (Administração) and the
// financeiro-admin item (Relatórios) — receptionists do not see
// them. `undefined` = visible to every member of the org. Resolved against
// the membership role via the canonical RBAC helpers in `@/domain`
// (never branch on `role` here directly).
type NavCapability = 'manageOrg'

// SPIKE (hours mode): per-org facts that gate a nav entry, resolved at
// request time (not from membership or a global flag). `usesAgenda` = the org
// has ≥1 unit in 'appointment' hours mode — drives whether the Agenda surface
// shows. Multi-vertical: a retail-only org (no appointment units) loses it.
type NavOrgSignal = 'usesAgenda'
export type NavOrgSignals = { usesAgenda: boolean }

type GatedNavItem = NavItem & {
  requires?: NavCapability
  requiresOrg?: NavOrgSignal
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
        requires: 'manageOrg',
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
    label: 'Administração',
    items: [
      {
        // Negócios — the single management surface (PRD Identidade
        // v2 — simplification): one folder hub that hosts BOTH Negócio settings
        // AND the Unidade create/edit/list. The separate "Unidades" nav entry
        // (`/units`) was retired; `/units` now redirects here. Route is the
        // English domain term `/organizations`; "Negócios" stays only as the label.
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
      {
        // Plano e cobrança — the Assinatura Oilio surface (brief 0073). Visible
        // to owner/manager; the page itself gates the subscribe/portal actions
        // to the owner only (defense in depth).
        href: '/billing',
        label: 'Plano e cobrança',
        icon: Wallet,
        match: 'prefix',
        requires: 'manageOrg',
      },
    ],
  },
  {
    // Personal account surfaces — visible to every member regardless of role.
    // Meu perfil is self-service rectification (brief 0032, AC-06) and
    // Privacidade is self-service erasure (AC-07); both are kept out of the
    // admin-only Administração section so receptionists still see them without
    // gaining org-admin links.
    label: 'Conta',
    items: [
      { href: '/settings/profile', label: 'Perfil', icon: UserCog, match: 'prefix' },
      { href: '/settings/privacy', label: 'Privacidade', icon: Lock, match: 'prefix' },
    ],
  },
]

function hasCapability(membership: Membership, capability: NavCapability): boolean {
  switch (capability) {
    case 'manageOrg':
      return canManageOrg(membership.role)
  }
}

function canSeeItem(membership: Membership, signals: NavOrgSignals, item: GatedNavItem): boolean {
  if (item.requiresOrg === 'usesAgenda' && !signals.usesAgenda) return false
  return item.requires === undefined || hasCapability(membership, item.requires)
}

// Builds the sidebar sections visible to a given membership (brief 0029,
// AC-08). Items are filtered by their declared `requires` capability and
// sections that end up empty are dropped — so a receptionist loses the whole
// Administração section plus the financeiro-admin items, while owner/manager
// see everything.
export function getNavSections(membership: Membership, signals: NavOrgSignals): NavSection[] {
  return ALL_NAV_SECTIONS.flatMap((section) => {
    const items = section.items
      .filter((item) => canSeeItem(membership, signals, item))
      .map(({ requires: _requires, ...item }) => item)
    if (items.length === 0) return []
    return [{ label: section.label, items }]
  })
}
