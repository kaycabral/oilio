import { TooltipProvider } from '@cbrl/design'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Customer } from '@/domain'

import { CustomersList } from './CustomersList'

vi.mock('@/features/customers/adapters/customers.actions', () => ({
  deleteCustomer: vi.fn(),
  getCustomerDeletionImpactAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/shared/org/org-context', () => ({
  useOrg: () => ({
    org: { slug: 'barbearia', name: 'Barbearia' },
    user: { uid: 'u-owner' },
    units: [
      {
        id: 'u1',
        slug: 'centro',
        name: 'Centro',
        address: {
          postalCode: '01310-100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Av. Paulista',
          number: '1000',
          complement: null,
        },
        agenda: {
          mode: 'appointment',
          businessHours: {
            monday: { open: '09:00', close: '18:00' },
            tuesday: null,
            wednesday: null,
            thursday: null,
            friday: null,
            saturday: null,
            sunday: null,
          },
          slotMinutes: 15,
          cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
          confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        },
      },
    ],
    activeUnitId: 'u1',
  }),
}))

function renderList(props: Parameters<typeof CustomersList>[0]) {
  return render(
    <TooltipProvider>
      <CustomersList {...props} />
    </TooltipProvider>,
  )
}

function makeCustomer(over: Partial<Customer>): Customer {
  return {
    id: 'c1',
    orgId: 't1',
    userId: 'u1',
    name: 'Maria Silva',
    mobile: '+5511900000000',
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...over,
  }
}

const customers: Customer[] = [
  makeCustomer({
    id: 'c1',
    name: 'Maria Silva',
    mobile: '+5511900000000',
    birthDate: '1990-05-16',
  }),
  makeCustomer({ id: 'c2', name: 'João Souza', mobile: '+5511988888888' }),
]

describe('CustomersList', () => {
  it('renders one row per customer with name, contact and avatar fallback', () => {
    renderList({ customers, searchQuery: '', canDelete: false, isFiltered: false })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByText('João Souza')).toBeInTheDocument()
    expect(screen.getByText('MS')).toBeInTheDocument()
    expect(screen.getByText('JS')).toBeInTheDocument()
  })

  it('marks the birthday next to the name only on the birthday', () => {
    const mmdd = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    renderList({
      customers: [
        makeCustomer({ id: 'b1', name: 'Aniversariante', birthDate: `1990-${mmdd(today)}` }),
        makeCustomer({ id: 'b2', name: 'Outro Dia', birthDate: `1989-${mmdd(tomorrow)}` }),
      ],
      searchQuery: '',
      canDelete: false,
      isFiltered: false,
    })
    expect(screen.getAllByLabelText('Aniversário hoje')).toHaveLength(1)
  })

  it('exposes a WhatsApp shortcut and the overflow menu per row', () => {
    renderList({ customers, searchQuery: '', canDelete: true, isFiltered: false })
    const wa = screen.getByRole('link', { name: 'WhatsApp de Maria Silva' })
    expect(wa).toHaveAttribute('href', expect.stringContaining('wa.me/'))
    expect(screen.getByRole('button', { name: 'Ações de Maria Silva' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ações de João Souza' })).toBeInTheDocument()
  })
})
