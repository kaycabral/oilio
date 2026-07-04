'use client'

import { UserMenu } from '@/components/user-menu'
import { unitUsesAgenda } from '@/domain'
import { NotificationBell } from '@/features/notifications/ui/NotificationBell'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { AppShell as BaseAppShell } from '@cbrl/design'
import { UserCog } from 'lucide-react'
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
  // unlock are hidden from the sidebar entirely (upsell lives in /billing + /pricing).
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
      headerEnd={
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserMenu
            name={user.name}
            secondary={user.secondary}
            avatarUrl={user.avatarUrl}
            shortcuts={[{ href: '/settings/profile', label: 'Perfil', icon: UserCog }]}
          />
        </div>
      }
    >
      {children}
    </BaseAppShell>
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
