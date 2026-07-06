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
      // Compact account menu for the mobile header (#1374): below `md` the
      // sidebar footer is off-canvas, so the account/Configurações/Sair menu is
      // otherwise unreachable. Same UserMenu, but WITHOUT a custom trigger — the
      // design shell then renders its compact avatar button (fits a phone header),
      // not the wide sidebar-footer trigger.
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
      {/* The Configurações modal (brief 0090). A client dialog anchored to the
          `#settings/X` URL hash, so it survives reload / tablet-resume / a form
          refresh instead of collapsing to a full page. */}
      <SettingsModal />
    </BaseAppShell>
  )
}

// Account menu anchored at the sidebar footer (brief 0090, AC-02). The trigger
// is a full-width `SidebarMenuButton` (avatar + name + active Negócio + a
// chevron) — the shadcn/Claude Code "nav user" pattern — so it reads clearly as
// an expandable button, not a bare avatar. It opens the identity dropdown
// (Configurações + Sair). Configurações opens the settings modal at its default
// section (Perfil); the app being context-based, billing follows the active
// Negócio automatically. On the icon-collapsed rail the button folds to just the
// avatar (the identity text and chevron are hidden by the sidebar's own rules).
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
    // Ajuda (helpHref) is intentionally omitted until a real /help surface
    // exists — the brief lists it, but there's no help route yet and we don't
    // invent one. The UserMenu supports it the day the route lands.
    // Telemetry (settings_section_viewed) is emitted server-side by each section
    // loader — track() can't run in this client component (brief 0090).
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
