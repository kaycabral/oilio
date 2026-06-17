import type { NavSection } from '@cbrl/design'
import { CalendarDays, CreditCard, UserCog } from 'lucide-react'

// Customer self-service nav (`/me/*`). Identity is the global User across every
// establishment — no tenant membership, no RBAC gating, so the list is static
// (unlike the role-filtered tenant nav in `nav-items.ts`). Single unlabeled
// group: the sidebar brand already reads "Minha conta". "Meu perfil" mirrors the
// establishment sidebar's account entry (same label + icon) for coherence.
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
