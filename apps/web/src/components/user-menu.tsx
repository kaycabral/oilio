'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { toRoute } from '@/shared/routes'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  UserMenu as UserMenuShell,
} from '@cbrl/design'
import { signOut } from 'firebase/auth'
import { CircleHelp, LogOut, type LucideIcon, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
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
// as the first item (gear icon + Ctrl+Shift+, hint) and a global keyboard shortcut
// navigates to it. `href` is the modal's default section (Perfil) — reached as a
// full page on direct load and intercepted as a dialog on client navigation
// (brief 0090). Kept separate from `shortcuts` because it carries the accelerator.
export type UserMenuSettings = {
  href: string
  label: string
}

// App wiring over the design `UserMenu`: the presentation (avatar trigger +
// identity dropdown) is shared; the account actions are wired here. `settings`
// (when given) opens the Configurações modal and binds the Ctrl+Shift+,
// accelerator; `shortcuts` are plain route links; the sign-out flow (session
// cookie + Firebase signOut + redirect) is always pinned to the bottom.
export function UserMenu({
  name,
  secondary,
  avatarUrl,
  shortcuts = [],
  settings,
  helpHref,
}: {
  name: string | null
  secondary: string | null
  avatarUrl: string | null
  shortcuts?: UserMenuShortcut[]
  settings?: UserMenuSettings
  helpHref?: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Ctrl+Shift+, opens the settings modal from anywhere in the app (brief 0090,
  // AC-03) — the same class of accelerator the Claude Code settings dialog uses.
  // Client navigation to the settings route is intercepted into a dialog; a
  // direct load of the same URL renders the full page.
  useEffect(() => {
    if (!settings) return
    const href = settings.href
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key === ',') {
        event.preventDefault()
        router.push(toRoute(href))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router, settings])

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
    <UserMenuShell name={name} secondary={secondary} avatarUrl={avatarUrl} triggerLabel="Conta">
      {settings ? (
        <DropdownMenuItem asChild>
          <Link href={toRoute(settings.href)}>
            <Settings aria-hidden="true" />
            {settings.label}
            <DropdownMenuShortcut>Ctrl+Shift+,</DropdownMenuShortcut>
          </Link>
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
