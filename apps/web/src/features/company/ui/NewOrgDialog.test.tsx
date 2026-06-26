import type { CreateOrgResult } from '@/features/onboarding/adapters/onboarding.actions'
import type { OrgContextValue } from '@/shared/org/org-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewOrgDialog } from './NewOrgDialog'

// "+ Novo negócio" does a SMOOTH context switch on success (Fix 1): it calls
// `createOrg`, then `setActiveOrg(orgId)` (the same mechanism `UnitOrgSwitcher`
// uses — write `currentOrgId` + `router.refresh()`) and closes the dialog. It
// must NEVER navigate away. Mock the server action + the org context.
const createOrg = vi.fn<(fd: FormData) => Promise<CreateOrgResult>>()
vi.mock('@/features/onboarding/adapters/onboarding.actions', () => ({
  createOrg: (fd: FormData) => createOrg(fd),
}))

const setActiveOrg = vi.fn<(orgId: string) => Promise<void>>()
vi.mock('@/shared/org/org-context', () => ({
  useOrg: (): Pick<OrgContextValue, 'setActiveOrg'> => ({ setActiveOrg }),
}))

beforeEach(() => {
  createOrg.mockReset()
  setActiveOrg.mockReset()
  setActiveOrg.mockResolvedValue(undefined)
})

function openDialog() {
  render(<NewOrgDialog />)
  fireEvent.click(screen.getByRole('button', { name: '+ Novo negócio' }))
}

function submitForm() {
  const submit = screen.getByRole('button', { name: /Criar negócio/i })
  const form = submit instanceof HTMLButtonElement ? submit.form : null
  expect(form).not.toBeNull()
  fireEvent.submit(form ?? submit)
}

describe('NewOrgDialog — smooth context switch on create (Fix 1)', () => {
  it('on success sets the new org active and closes — no navigation', async () => {
    createOrg.mockResolvedValue({ ok: true, orgId: 'org-new' })
    openDialog()
    expect(screen.getByText('Novo negócio')).toBeInTheDocument()

    submitForm()

    await waitFor(() => expect(setActiveOrg).toHaveBeenCalledWith('org-new'))
    // Dialog closed → its title is gone (soft switch, stayed on the orgs page).
    await waitFor(() => expect(screen.queryByText('Novo negócio')).not.toBeInTheDocument())
  })

  it('on failure shows the error and never switches org', async () => {
    createOrg.mockResolvedValue({ ok: false, error: 'Boom' })
    openDialog()

    submitForm()

    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(setActiveOrg).not.toHaveBeenCalled()
  })
})
