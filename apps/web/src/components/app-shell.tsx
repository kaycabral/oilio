'use client'

import { UserMenu } from '@/components/user-menu'
import { unitUsesAgenda } from '@/domain'
import { NotificationBell } from '@/features/notifications/ui/NotificationBell'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { AppShell as BaseAppShell } from '@cbrl/design'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getNavSections } from './nav-items'
import { UnitOrgSwitcher } from './unit-org-switcher'

export function AppShell({
  orgName,
  user,
  children,
}: {
  orgName: string
  user: { name: string | null; secondary: string | null; avatarUrl: string | null }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { membership, units, tier } = useOrg()
  // SPIKE (hours mode): the org "uses the agenda" iff any unit is in
  // appointment mode — drives whether the Agenda nav item shows (multi-vertical).
  const usesAgenda = units.some((u) => unitUsesAgenda(u))
  // `tier` gates the billing axis (brief 0088 AC-06): surfaces the plan doesn't
  // unlock are hidden from the sidebar entirely (upsell lives in /settings/billing + /pricing).
  const sections = getNavSections(membership, { usesAgenda }, tier)

  return (
    <BaseAppShell
      brand={<Brand orgName={orgName} />}
      sections={sections}
      pathname={pathname}
      renderNavLink={(item, { onNavigate, children: content }) => (
        <Link href={toRoute(item.href)} onClick={onNavigate}>
          {content}
        </Link>
      )}
      headerStart={<UnitOrgSwitcher />}
      headerEnd={<NotificationBell />}
      footer={
        <SidebarUserMenu
          name={user.name}
          secondary={user.secondary}
          avatarUrl={user.avatarUrl}
          orgName={orgName}
        />
      }
    >
      {children}
    </BaseAppShell>
  )
}

// Account menu anchored at the sidebar footer (brief 0090, AC-02): the avatar
// opens the identity dropdown (Configurações + Sair), with the member name and
// the active Negócio shown alongside it. Configurações opens the
// settings modal at its default section (Perfil); the app being context-based,
// billing follows the active Negócio automatically. On the icon-collapsed rail
// the identity text folds away and only the avatar trigger remains.
function SidebarUserMenu({
  name,
  secondary,
  avatarUrl,
  orgName,
}: {
  name: string | null
  secondary: string | null
  avatarUrl: string | null
  orgName: string
}) {
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      {/* Ajuda (helpHref) is intentionally omitted until a real /help surface
          exists — the brief lists it, but there's no help route yet and we don't
          invent one. The UserMenu supports it the day the route lands.
          Telemetry (settings_modal_opened) is emitted server-side by the Perfil
          page — track() can't run in this client component (brief 0090). */}
      <UserMenu
        name={name}
        secondary={secondary}
        avatarUrl={avatarUrl}
        settings={{ href: '/settings/profile', label: 'Configurações' }}
      />
      <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-medium">{name ?? 'Conta'}</span>
        <span className="text-muted-foreground truncate text-xs">{orgName}</span>
      </div>
    </div>
  )
}

// Org name expands inline; on the icon-collapsed rail it folds to initials.
function Brand({ orgName }: { orgName: string }) {
  const initials = computeInitials(orgName)
  return (
    <>
      <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">
        {orgName}
      </span>
      <span className="hidden text-base font-semibold group-data-[collapsible=icon]:block">
        {initials}
      </span>
    </>
  )
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'S'
}
