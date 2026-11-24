import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PendenciesPanel } from './PendenciesPanel'

describe('PendenciesPanel', () => {
  it('renders empty state when no pendencies', () => {
    render(
      <PendenciesPanel
        pendencies={{ openOrders: [], inactiveCustomers: [] }}
        unitsById={{}}
        customersById={{}}
      />,
    )
    expect(screen.getByText('Nada pendente')).toBeInTheDocument()
    expect(screen.getByText('Vendas em dia. Sem clientes inativos no momento.')).toBeInTheDocument()
  })

  it('lists open orders with customer name, unit and hours open', () => {
    render(
      <PendenciesPanel
        pendencies={{
          openOrders: [
            {
              id: 'cm1',
              customerId: 'c1',
              unitId: 'u1',
              openedAt: '',
              hoursOpen: 30,
              totalCents: 10000,
            },
          ],
          inactiveCustomers: [],
        }}
        unitsById={{ u1: 'Centro' }}
        customersById={{ c1: 'Alice' }}
      />,
    )
    expect(screen.getByText('Vendas em aberto')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText(/Centro.*30h em aberto.*R\$\s?100,00/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Alice/ })
    expect(link).toHaveAttribute('href', '/orders/cm1')
  })

  it('renders multi-day order as "N dias em aberto"', () => {
    render(
      <PendenciesPanel
        pendencies={{
          openOrders: [
            {
              id: 'cm1',
              customerId: 'c1',
              unitId: 'u1',
              openedAt: '',
              hoursOpen: 72,
              totalCents: 0,
            },
          ],
          inactiveCustomers: [],
        }}
        unitsById={{ u1: 'Centro' }}
        customersById={{ c1: 'Alice' }}
      />,
    )
    expect(screen.getByText(/3 dias em aberto/)).toBeInTheDocument()
  })

  it('lists inactive customers with deep links', () => {
    render(
      <PendenciesPanel
        pendencies={{
          openOrders: [],
          inactiveCustomers: [{ id: 'c1', name: 'Bob', lastSeenAt: '', daysInactive: 90 }],
        }}
        unitsById={{ u1: 'Centro' }}
        customersById={{ c1: 'Bob' }}
      />,
    )
    expect(screen.getByText('Clientes inativos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Bob/ })).toHaveAttribute('href', '/customers/c1')
    expect(screen.getByText('90 dias sem visitar')).toBeInTheDocument()
  })
})
