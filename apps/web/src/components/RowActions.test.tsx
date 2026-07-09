import { toRoute } from '@/shared/routes'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RowActions } from './RowActions'

describe('RowActions', () => {
  it('renders nothing when there are no actions', () => {
    render(<RowActions actions={[]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a ⋯ trigger with the row-specific accessible name', () => {
    render(
      <RowActions
        label="Ações de Maria"
        actions={[{ kind: 'link', label: 'Editar', href: toRoute('/customers/c1') }]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Ações de Maria' })).toBeInTheDocument()
  })

  it('mounts the shared confirm dialog plumbing for a delete action', () => {
    render(
      <RowActions
        actions={[
          {
            kind: 'delete',
            action: () => Promise.resolve({ ok: true } as const),
            title: 'Excluir item?',
            description: 'Some descrição.',
          },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Ações' })).toBeInTheDocument()
    expect(screen.queryByText('Excluir item?')).not.toBeInTheDocument()
  })
})
