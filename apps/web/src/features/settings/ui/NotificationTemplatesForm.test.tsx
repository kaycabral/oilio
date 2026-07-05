// NotificationTemplatesForm (brief 0090 cleanup): enabled templates show their
// full editor; disabled ones collapse into a compact "Desativadas" list where
// they can be turned back on — so hiding them is never a dead end.

import type { MessageTemplate } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/adapters/notifications.actions', () => ({
  updateMessageTemplate: vi.fn(() => Promise.resolve({ ok: true })),
}))

import { NotificationTemplatesForm } from './NotificationTemplatesForm'

function template(over: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 'birthday',
    orgId: 'org1',
    type: 'birthday',
    body: 'Parabéns {cliente_nome}!',
    enabled: true,
    updatedAt: '',
    lastActorUid: null,
    ...over,
  }
}

describe('NotificationTemplatesForm', () => {
  it('renders the editor (textarea) for an enabled template', () => {
    render(<NotificationTemplatesForm templates={[template()]} canManage />)
    expect(screen.getByText('Aniversário')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBeInTheDocument()
  })

  it('hides a disabled template from the editor list, showing it under "Desativadas"', () => {
    render(
      <NotificationTemplatesForm
        templates={[template({ type: 'birthday', enabled: false, id: 'birthday' })]}
        canManage
      />,
    )
    // No editor (textarea) for the disabled one…
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).not.toBeInTheDocument()
    // …it lives in the compact re-enable list.
    expect(screen.getByText('Desativadas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeInTheDocument()
  })

  it('shows an empty message when no template is active', () => {
    render(<NotificationTemplatesForm templates={[template({ enabled: false })]} canManage />)
    expect(screen.getByText(/Nenhuma notificação ativa/, { exact: false })).toBeInTheDocument()
  })

  it('splits active editors from the disabled list', () => {
    render(
      <NotificationTemplatesForm
        templates={[
          template({ type: 'birthday', id: 'birthday', enabled: true }),
          template({ type: 'new_customer', id: 'new_customer', enabled: false }),
        ]}
        canManage
      />,
    )
    // Exactly one editor (the active birthday); the disabled new_customer shows
    // only in the re-enable list (a single "Ativar" button), not as an editor.
    expect(screen.getAllByRole('textbox', { name: 'Mensagem' })).toHaveLength(1)
    expect(screen.getByText('Desativadas')).toBeInTheDocument()
    expect(screen.getByText('Novo cliente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar' })).toBeInTheDocument()
  })

  it('does not show the "Desativadas" section when all templates are active', () => {
    render(<NotificationTemplatesForm templates={[template()]} canManage />)
    expect(screen.queryByText('Desativadas')).not.toBeInTheDocument()
  })
})
