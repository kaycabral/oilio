import type { NavSection } from '@oilio/design'
import { CalendarDays, CreditCard, UserCog } from 'lucide-react'

export const ME_NAV_SECTIONS: NavSection[] = [
  {
    label: '',
    items: [
      { href: '/me/appointments', label: 'Agendamentos', icon: CalendarDays, match: 'prefix' },
      { href: '/me/subscriptions', label: 'Assinaturas', icon: CreditCard, match: 'prefix' },
      { href: '/me/profile', label: 'Perfil', icon: UserCog, match: 'prefix' },
    ],
  },
]
