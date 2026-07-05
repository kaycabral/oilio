'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { toRoute } from '@/shared/routes'
import { DropdownMenuItem, DropdownMenuSeparator, UserMenu as UserMenuShell } from '@cbrl/design'
import { signOut } from 'firebase/auth'
import { CircleHelp, LogOut, type LucideIcon, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

// A single route shortcut shown above "Sair" in the account menu. The list is
// open-ended — each context (org app, customer `/me`, …) passes whatever
// shortcuts make sense (Perfil on `/me`; the org app uses `settings` instead).
export type UserMenuShortcut = {
  href: string
  label: string
  icon: LucideIcon
}

// The Configurações entry that opens the settings modal. When present, it renders
// as the first item (gear icon). `hash` is the modal's URL hash for the default
// section (e.g. `#settings/profile`): clicking sets it, which the client
// SettingsModal observes and opens on (brief 0090). Anchoring to the hash — not a
// route — is what lets the modal survive a hard navigation (reload / tablet
// resume / a form's refresh) instead of collapsing to a full page.
export type UserMenuSettings = {
  hash: string
  label: string
}

// App wiring over the design `UserMenu`: the presentation (avatar trigger +
// identity dropdown) is shared; the account actions are wired here. `settings`
// (when given) opens the Configurações modal via its URL hash; `shortcuts` are
// plain route links; the sign-out flow (session cookie + Firebase signOut +
// redirect) is always pinned to the bottom.
export function UserMenu({
  name,
  secondary,
  avatarUrl,
  shortcuts = [],
  settings,
  helpHref,
  trigger,
  align,
}: {
  name: string | null
  secondary: string | null
  avatarUrl: string | null
  shortcuts?: UserMenuShortcut[]
  settings?: UserMenuSettings
  helpHref?: string
  // Custom trigger (e.g. the wide sidebar-footer button); defaults to the
  // compact avatar button in the design shell. `align` positions the dropdown
  // relative to it — 'start' reads better for a wide footer trigger.
  trigger?: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // No keyboard accelerator for now: Ctrl+Shift+, collided with the browser.
  // Configurações opens via the dropdown item; app-wide shortcuts get defined
  // deliberately later (brief 0090 originally speced one — deferred).

  async function handleLogout() {
    if (loading) return
    setLoading(true)
    try {
      await fetch('/api/session', { method: 'DELETE' })
      await signOut(getClientAuth()).catch(() => {})
      router.replace('/login')
      router.refresh()
    } catch {
      toast.error('Não foi possível sair. Tente novamente.')
      setLoading(false)
    }
  }

  const hasTopItems = Boolean(settings) || shortcuts.length > 0 || Boolean(helpHref)

  return (
    <UserMenuShell
      name={name}
      secondary={secondary}
      avatarUrl={avatarUrl}
      triggerLabel="Conta"
      trigger={trigger}
      align={align}
    >
      {settings ? (
        <DropdownMenuItem asChild>
          {/* A same-page hash link (not a route) — setting the hash is what opens
              the client SettingsModal, and it survives reload/refresh. */}
          <a href={settings.hash}>
            <Settings aria-hidden="true" />
            {settings.label}
          </a>
        </DropdownMenuItem>
      ) : null}
      {shortcuts.map((shortcut) => (
        <DropdownMenuItem key={shortcut.href} asChild>
          <Link href={toRoute(shortcut.href)}>
            <shortcut.icon aria-hidden="true" />
            {shortcut.label}
          </Link>
        </DropdownMenuItem>
      ))}
      {helpHref ? (
        <DropdownMenuItem asChild>
          <Link href={toRoute(helpHref)}>
            <CircleHelp aria-hidden="true" />
            Ajuda
          </Link>
        </DropdownMenuItem>
      ) : null}
      {hasTopItems ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onSelect={() => void handleLogout()} disabled={loading}>
        <LogOut aria-hidden="true" />
        {loading ? 'Saindo…' : 'Sair'}
      </DropdownMenuItem>
    </UserMenuShell>
  )
}
