import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LoginVisual } from './LoginVisual'

describe('LoginVisual', () => {
  it('composes the montage from rendered product surfaces', () => {
    render(<LoginVisual />)
    // Real markup, not a screenshot: the agenda rows and the tiles are queryable
    // text. If someone swaps this for an <img>, these assertions go red.
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Marcos A.')).toBeInTheDocument()
    expect(screen.getByText('Assinantes ativos')).toBeInTheDocument()
    expect(screen.getByText('Recebido no mês')).toBeInTheDocument()
  })

  it('renders no image asset', () => {
    render(<LoginVisual />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders synchronously, with no data dependency', () => {
    // The panel is static by contract: the login route must paint without
    // waiting on a fetch or a server action. A render that needed data would
    // throw or suspend here instead of resolving inline.
    expect(() => render(<LoginVisual />)).not.toThrow()
    expect(screen.getByText('48')).toBeInTheDocument()
  })
})
