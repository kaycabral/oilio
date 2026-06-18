import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormalizeFlow } from './FormalizeFlow'

type FormalizeResult = { ok: true } | { ok: false; error: string }
const formalizeOrg = vi.fn<(fd: FormData) => Promise<FormalizeResult>>()

vi.mock('@/features/company/adapters/formalize.actions', () => ({
  formalizeOrg: (fd: FormData): Promise<FormalizeResult> => formalizeOrg(fd),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const LOOKUP_BODY = {
  profile: {
    taxId: '40148980000199',
    isMei: false,
    taxRegime: 'simples_nacional',
    primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    shareCapital: 1000,
    activityStartedAt: '2020-12-17',
  },
  legalName: 'CABRAL TECNOLOGIA LTDA',
  tradeName: 'CABRAL TECH',
}

function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  const response: Pick<Response, 'ok' | 'status' | 'json'> = {
    ok,
    status,
    json: () => Promise.resolve(body),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  )
}

beforeEach(() => {
  formalizeOrg.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FormalizeFlow (brief 0048 AC-07/AC-08)', () => {
  it('renders the CNPJ CTA empty-state and masks input as the owner types', () => {
    render(<FormalizeFlow />)
    expect(screen.getByText('Formalizar empresa')).toBeInTheDocument()
    const input = screen.getByLabelText('CNPJ')
    fireEvent.change(input, { target: { value: '40148980000199' } })
    expect(input).toHaveValue('40.148.980/0001-99')
  })

  it('keeps the lookup button disabled until the CNPJ has 14 digits', () => {
    render(<FormalizeFlow />)
    const button = screen.getByRole('button', { name: 'Consultar CNPJ' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '40148980000199' } })
    expect(button).toBeEnabled()
  })

  it('lookup → review shows razão social / fantasia before confirming', async () => {
    mockFetchOnce(LOOKUP_BODY)
    render(<FormalizeFlow />)
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '40148980000199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar CNPJ' }))

    expect(await screen.findByText('Confira os dados da Receita')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECNOLOGIA LTDA')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECH')).toBeInTheDocument()
    expect(screen.getByText('Simples Nacional')).toBeInTheDocument()
  })

  it('confirm submits the looked-up data to the action', async () => {
    mockFetchOnce(LOOKUP_BODY)
    formalizeOrg.mockResolvedValue({ ok: true })
    render(<FormalizeFlow />)
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '40148980000199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar CNPJ' }))
    await screen.findByText('Confira os dados da Receita')

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e formalizar' }))
    await waitFor(() => expect(formalizeOrg).toHaveBeenCalledTimes(1))
    const fd = formalizeOrg.mock.calls[0]?.[0]
    expect(fd?.get('taxId')).toBe('40148980000199')
    expect(fd?.get('legalName')).toBe('CABRAL TECNOLOGIA LTDA')
  })

  it('surfaces a lookup error and stays on the input step', async () => {
    mockFetchOnce({ error: 'CNPJ não encontrado.' }, false, 404)
    render(<FormalizeFlow />)
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '40148980000199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar CNPJ' }))
    expect(await screen.findByText('CNPJ não encontrado.')).toBeInTheDocument()
    expect(screen.queryByText('Confira os dados da Receita')).toBeNull()
  })

  it('cancel from review returns to the input step', async () => {
    mockFetchOnce(LOOKUP_BODY)
    render(<FormalizeFlow />)
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '40148980000199' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consultar CNPJ' }))
    await screen.findByText('Confira os dados da Receita')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Formalizar empresa')).toBeInTheDocument()
  })
})
