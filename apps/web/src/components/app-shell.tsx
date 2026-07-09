'use client'

import { UserMenu } from '@/components/user-menu'
import { unitUsesAgenda } from '@/domain'
import { NotificationBell } from '@/features/notifications/ui/NotificationBell'
import { SettingsModal, settingsHash } from '@/features/settings/ui/SettingsModal'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AppShell as BaseAppShell,
  SidebarMenuButton,
  userMenuInitials,
} from '@cbrl/design'
import { ChevronsUpDown } from 'lucide-react'
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
  const usesAgenda = units.some((u) => unitUsesAgenda(u))
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
      account={
        <UserMenu
          name={user.name}
          secondary={user.secondary}
          avatarUrl={user.avatarUrl}
          settings={{ hash: settingsHash('profile'), label: 'Configurações' }}
          align="end"
        />
      }
    >
      {children}
      <SettingsModal />
    </BaseAppShell>
  )
}

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
    <UserMenu
      name={name}
      secondary={secondary}
      avatarUrl={avatarUrl}
      settings={{ hash: settingsHash('profile'), label: 'Configurações' }}
      align="start"
      trigger={
        <SidebarMenuButton
          size="lg"
          aria-label="Conta"
          className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
        >
          <Avatar size="default" className="rounded-md">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? secondary ?? ''} /> : null}
            <AvatarFallback className="rounded-md">
              {userMenuInitials(name, secondary)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate text-sm font-medium">{name ?? 'Conta'}</span>
            <span className="text-muted-foreground truncate text-xs">{orgName}</span>
          </div>
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground ml-auto" />
        </SidebarMenuButton>
      }
    />
  )
}

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
