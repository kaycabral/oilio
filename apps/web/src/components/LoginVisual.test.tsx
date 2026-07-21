import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LoginVisual } from './LoginVisual'

describe('LoginVisual', () => {
  it('composes the montage from real markup, so a screenshot swap would go red', () => {
    render(<LoginVisual />)
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Marcos A.')).toBeInTheDocument()
    expect(screen.getByText('Assinantes ativos')).toBeInTheDocument()
    expect(screen.getByText('Recebido no mês')).toBeInTheDocument()
  })

  it('renders no image asset', () => {
    render(<LoginVisual />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders synchronously, so the login route never waits on data to paint', () => {
    expect(() => render(<LoginVisual />)).not.toThrow()
    expect(screen.getByText('48')).toBeInTheDocument()
  })
})
