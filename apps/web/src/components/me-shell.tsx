'use client'

import { UserMenu } from '@/components/user-menu'
import { toRoute } from '@/shared/routes'
import { AppShell as BaseAppShell } from '@oilio/design'
import { UserCog } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ME_NAV_SECTIONS } from './me-nav-items'

export function MeShell({
  user,
  children,
}: {
  user: { name: string | null; secondary: string | null; avatarUrl: string | null }
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <BaseAppShell
      brand={<span className="text-base font-semibold">Minha conta</span>}
      sections={ME_NAV_SECTIONS}
      pathname={pathname}
      renderNavLink={(item, { onNavigate, children: content }) => (
        <Link href={toRoute(item.href)} onClick={onNavigate}>
          {content}
        </Link>
      )}
      headerEnd={
        <UserMenu
          name={user.name}
          secondary={user.secondary}
          avatarUrl={user.avatarUrl}
          shortcuts={[{ href: '/me/profile', label: 'Perfil', icon: UserCog }]}
        />
      }
    >
      {children}
    </BaseAppShell>
  )
}
