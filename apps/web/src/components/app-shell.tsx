'use client'

import { UserMenu } from '@/components/user-menu'
import { unitUsesAgenda } from '@/domain'
import { NotificationBell } from '@/features/notifications/ui/NotificationBell'
import { toRoute } from '@/shared/routes'
import { useTenant } from '@/shared/tenant/tenant-context'
import { AppShell as BaseAppShell } from '@cbrl/design'
import { UserCog } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getNavSections } from './nav-items'
import { UnitTenantSwitcher } from './unit-tenant-switcher'

export function AppShell({
  tenantName,
  user,
  children,
}: {
  tenantName: string
  user: { name: string | null; secondary: string | null; avatarUrl: string | null }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { membership, units } = useTenant()
  // SPIKE (hours mode): the tenant "uses the agenda" iff any unit is in
  // appointment mode — drives whether the Agenda nav item shows (multi-vertical).
  const usesAgenda = units.some((u) => unitUsesAgenda(u))
  const sections = getNavSections(membership, { usesAgenda })

  return (
    <BaseAppShell
      brand={<Brand tenantName={tenantName} />}
      sections={sections}
      pathname={pathname}
      renderNavLink={(item, { onNavigate, children: content }) => (
        <Link href={toRoute(item.href)} onClick={onNavigate}>
          {content}
        </Link>
      )}
      headerStart={<UnitTenantSwitcher />}
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

// Tenant name expands inline; on the icon-collapsed rail it folds to initials.
function Brand({ tenantName }: { tenantName: string }) {
  const initials = computeInitials(tenantName)
  return (
    <>
      <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">
        {tenantName}
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
