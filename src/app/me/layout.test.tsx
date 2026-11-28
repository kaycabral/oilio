import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSessionUser: vi.fn(),
  listLinkedOrgIds: vi.fn((): Promise<string[]> => Promise.resolve([])),
}))

vi.mock('@/shared/auth/session', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@cbrl/supabase', () => ({ isSupabaseConfigured: mocks.isSupabaseConfigured }))
vi.mock('@/shared/identity/org-links', () => ({ listLinkedOrgIds: mocks.listLinkedOrgIds }))

vi.mock('@/components/me-shell', () => ({
  MeShell: ({ children }: { children: React.ReactNode }) => (
    <main aria-label="me-shell">{children}</main>
  ),
}))

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`__REDIRECT__:${path}`)
  },
}))

import MeLayout from './layout'

type Gate = React.ReactElement<
  { children: React.ReactNode },
  (props: { children: React.ReactNode }) => Promise<React.ReactElement>
>

function callLayout(): Promise<React.ReactElement> {
  const boundary = MeLayout({ children: <div aria-label="children" /> }) as React.ReactElement<{
    children: Gate
  }>
  const gate = boundary.props.children
  return gate.type(gate.props)
}

async function captureRedirect(): Promise<string> {
  try {
    await callLayout()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('__REDIRECT__:')) return msg.slice('__REDIRECT__:'.length)
    throw err
  }
  throw new Error('Expected redirect to be thrown, but layout resolved')
}

beforeEach(() => {
  mocks.isSupabaseConfigured.mockReset().mockReturnValue(true)
  mocks.getSessionUser.mockReset()
  mocks.listLinkedOrgIds.mockReset().mockResolvedValue([])
})

describe('MeLayout — client-area gate', () => {
  it('redirects to / when auth is not configured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false)
    expect(await captureRedirect()).toBe('/')
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
  })

  it('redirects to /login when there is no session', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    expect(await captureRedirect()).toBe('/login')
  })

  it('redirects a logged-in user with no org link away from /me', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: 'no-link' })
    mocks.listLinkedOrgIds.mockResolvedValue([])
    expect(await captureRedirect()).toBe('/')
  })

  it('renders the shell for a linked client', async () => {
    mocks.getSessionUser.mockResolvedValue({ uid: 'client-1' })
    mocks.listLinkedOrgIds.mockResolvedValue(['org-1'])
    const { render, screen } = await import('@testing-library/react')
    render(await callLayout())
    expect(screen.getByLabelText('me-shell')).toBeInTheDocument()
  })
})
