'use client'

import { signOutClient } from '@/shared/auth/sign-out'
import { toRoute } from '@/shared/routes'
import { DropdownMenuItem, DropdownMenuSeparator, UserMenu as UserMenuShell } from '@cbrl/design'
import { CircleHelp, LogOut, type LucideIcon, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

export type UserMenuShortcut = {
  href: string
  label: string
  icon: LucideIcon
}

export type UserMenuSettings = {
  hash: string
  label: string
}

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
  trigger?: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    if (loading) return
    setLoading(true)
    try {
      await signOutClient()
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
