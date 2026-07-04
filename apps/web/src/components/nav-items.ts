import { canManageOrg, type Membership } from '@/domain'
import { type Capability, hasCapability as tierHasCapability } from '@/domain/billing/capabilities'
import { type Tier } from '@/domain/billing/tiers'
import type { NavItem, NavSection } from '@cbrl/design'
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
} from 'lucide-react'

// Minimum capability a nav entry requires to be shown (brief 0029 AC-08; brief
// 0075). `manageOrg` gates org-admin surfaces (Administração) and the
// financeiro-admin item (Relatórios). The `canManage*` values are membership
// capabilities (brief 0075): a self-scoped memberOperation (whose matrix keeps
// every `canManage*` false) loses Clientes/Catálogo/Planos/Assinaturas, while
// the balcão (recepção) keeps the ones its preset grants (e.g. Clientes).
// `undefined` = visible to every member of the org. Always resolved via the
// canonical helpers (never branch on `role` here directly).
type NavCapability =
  | 'manageOrg'
  | 'canManageCustomers'
  | 'canManageCatalog'
  | 'canManagePlans'
  | 'canManageSubscriptions'

// SPIKE (hours mode): per-org facts that gate a nav entry, resolved at
// request time (not from membership or a global flag). `usesAgenda` = the org
// has ≥1 unit in 'appointment' hours mode — drives whether the Agenda surface
// shows. Multi-vertical: a retail-only org (no appointment units) loses it.
type NavOrgSignal = 'usesAgenda'
export type NavOrgSignals = { usesAgenda: boolean }

type GatedNavItem = NavItem & {
  requires?: NavCapability
  requiresOrg?: NavOrgSignal
  // Billing/tier axis (brief 0088 AC-06): the item is hidden when the org's tier
  // does not unlock this capability. ORTHOGONAL to `requires` (RBAC permission
  // matrix): both must pass to show the item. A separate field — NOT overloading
  // `requires` — because the two eixos are distinct (who-can vs plan-unlocks) and
  // resolve against different sources (membership vs tier). Named `requiresTier`
  // and read via the billing `hasCapability` (aliased `tierHasCapability` to
  // avoid the collision with the LOCAL RBAC `hasCapability` below).
  requiresTier?: Capability
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
    ],
  },
  // Personal account surfaces (Perfil, Privacidade) and billing moved OUT of the
  // sidebar into the Configurações modal, reached via the UserMenu at the sidebar
  // footer (brief 0090). The sidebar is now operational-only: Operação, Cadastros,
  // Administração (Negócios, Equipe). "Plano e cobrança" became the Cobrança
  // section of the modal (route /settings/billing).
]

function hasCapability(membership: Membership, capability: NavCapability): boolean {
  switch (capability) {
    case 'manageOrg':
      return canManageOrg(membership.role)
    // Membership capabilities (brief 0075) — read straight off the matrix so a
    // self-scoped memberOperation drops these surfaces. Listed explicitly (not
    // `membership.permissions[capability]`) so the type stays a closed union and
    // adding a nav capability is a compile-time decision.
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
  // Billing/tier axis (brief 0088 AC-06): hide surfaces the plan doesn't unlock.
  // Orthogonal to the RBAC check below — both eixos must pass.
  if (item.requiresTier !== undefined && !tierHasCapability(tier, item.requiresTier)) return false
  return item.requires === undefined || hasCapability(membership, item.requires)
}

// Builds the sidebar sections visible to a given membership (brief 0029,
// AC-08). Items are filtered by their declared `requires` capability and
// sections that end up empty are dropped — so a receptionist loses the whole
// Administração section plus the financeiro-admin items, while owner/manager
// see everything.
export function getNavSections(
  membership: Membership,
  signals: NavOrgSignals,
  tier: Tier,
): NavSection[] {
  return ALL_NAV_SECTIONS.flatMap((section) => {
    const items = section.items
      .filter((item) => canSeeItem(membership, signals, tier, item))
      .map(({ requires: _requires, requiresTier: _requiresTier, ...item }) => item)
    if (items.length === 0) return []
    return [{ label: section.label, items }]
  })
}
