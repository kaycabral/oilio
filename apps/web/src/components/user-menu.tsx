'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { toRoute } from '@/shared/routes'
import { DropdownMenuItem, DropdownMenuSeparator, UserMenu as UserMenuShell } from '@cbrl/design'
import { signOut } from 'firebase/auth'
import { LogOut, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

// A single route shortcut shown above "Sair" in the account menu. The list is
// open-ended — each context (org app, customer `/me`, …) passes whatever
// shortcuts make sense (Perfil today; settings, billing, help… tomorrow).
export type UserMenuShortcut = {
  href: string
  label: string
  icon: LucideIcon
}

// App wiring over the design `UserMenu`: the presentation (avatar trigger +
// identity dropdown) is shared; the account actions are wired here. `shortcuts`
// are plain route links (rendered as menu items); the sign-out flow (session
// cookie + Firebase signOut + redirect) is Firebase/Next-specific and always
// pinned to the bottom.
export function UserMenu({
  name,
  secondary,
  avatarUrl,
  shortcuts,
}: {
  name: string | null
  secondary: string | null
  avatarUrl: string | null
  shortcuts: UserMenuShortcut[]
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    if (loading) return
    setLoading(true)
    try {
      await fetch('/api/session', { method: 'DELETE' })
      await signOut(getClientAuth()).catch(() => {})
      router.replace('/login')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logout falhou')
      setLoading(false)
    }
  }

  return (
    <UserMenuShell name={name} secondary={secondary} avatarUrl={avatarUrl} triggerLabel="Conta">
      {shortcuts.map((shortcut) => (
        <DropdownMenuItem key={shortcut.href} asChild>
          <Link href={toRoute(shortcut.href)}>
            <shortcut.icon aria-hidden="true" />
            {shortcut.label}
          </Link>
        </DropdownMenuItem>
      ))}
      {shortcuts.length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onSelect={() => void handleLogout()} disabled={loading}>
        <LogOut aria-hidden="true" />
        {loading ? 'Saindo…' : 'Sair'}
      </DropdownMenuItem>
    </UserMenuShell>
  )
}
