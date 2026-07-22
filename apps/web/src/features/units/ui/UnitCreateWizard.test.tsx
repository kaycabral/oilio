import { EMPTY_BUSINESS_HOURS } from '@/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UnitCreateWizard, wizardSteps } from './UnitCreateWizard'

const WEEKDAY_RANGE = { open: '09:00', close: '18:00' }

vi.mock('@/features/units/adapters/units.actions', () => ({
  createUnit: vi.fn(),
  checkUnitSlugAvailability: vi.fn(() => Promise.resolve({ ok: true, available: true })),
  getUnitAdditionCostPreview: vi.fn(() => Promise.resolve({ ok: true, cost: { charged: false } })),
  trackUnitWizardEvent: vi.fn(() => Promise.resolve()),
}))

const cepLookup = vi.hoisted(() => {
  type Lookup = {
    postalCode: string
    state: string
    city: string
    neighborhood: string
    street: string
  }
  return {
    result: {
      loading: false,
      data: null as Lookup | null,
      error: null as string | null,
    },
  }
})

vi.mock('@/hooks/use-cep-lookup', () => ({
  useCepLookup: () => cepLookup.result,
}))

vi.mock('@/shared/org/org-context', () => ({
  useOrg: () => ({ org: { slug: 'barbearia-x' } }),
}))

async function fillIdentity() {
  await userEvent.type(screen.getByRole('textbox', { name: 'Nome' }), 'Filial Centro')
  await userEvent.type(screen.getByLabelText(/whatsapp/i), '11988887777')
}

describe('wizardSteps', () => {
  it('has 4 steps without appointment mode', () => {
    expect(wizardSteps('fixed')).toEqual(['identity', 'address', 'hours', 'review'])
    expect(wizardSteps(null)).toEqual(['identity', 'address', 'hours', 'review'])
  })

  it('inserts the Agenda step before review in appointment mode', () => {
    expect(wizardSteps('appointment')).toEqual(['identity', 'address', 'hours', 'agenda', 'review'])
  })
})

describe('UnitCreateWizard — shell (AC-01)', () => {
  it('opens on step 1 with the stepper counter and only the identity panel visible', () => {
    render(<UnitCreateWizard />)
    expect(screen.getByText('Passo 1 de 4')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Nome' })).toBeVisible()
    const cep = screen.getByRole('textbox', { name: 'CEP', hidden: true })
    expect(cep).toBeInTheDocument()
    expect(cep).not.toBeVisible()
    expect(screen.getByText('Funcionamento')).toBeInTheDocument()
  })
})

describe('UnitCreateWizard — step gating (AC-02)', () => {
  it('blocks Continuar while required fields of the current step are empty', () => {
    render(<UnitCreateWizard />)
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })

  it('hints the first pending field of the step', async () => {
    render(<UnitCreateWizard />)
    expect(await screen.findByText(/Preencha “Nome” para continuar/)).toBeInTheDocument()
  })

  it('unblocks Continuar when the step becomes valid', async () => {
    render(<UnitCreateWizard />)
    await fillIdentity()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()
  })
})

describe('UnitCreateWizard — back navigation preserves state (AC-03)', () => {
  it('keeps typed values when navigating back to a previous step', async () => {
    render(<UnitCreateWizard />)
    await fillIdentity()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByRole('textbox', { name: 'CEP' })).toBeVisible()
    expect(screen.getByText('Passo 2 de 4')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Filial Centro')
  })

  it('navigates back via a done step in the stepper', async () => {
    render(<UnitCreateWizard />)
    await fillIdentity()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: /Identidade/ }))
    expect(screen.getByRole('textbox', { name: 'Nome' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Filial Centro')
  })

  it('keeps future steps disabled in the stepper', () => {
    render(<UnitCreateWizard />)
    expect(screen.getByRole('button', { name: 'Revisão' })).toBeDisabled()
  })
})

describe('UnitCreateWizard — single form submit (AC-04)', () => {
  it('keeps hidden panels mounted so every step field stays in the document', () => {
    render(<UnitCreateWizard />)
    expect(screen.getByRole('textbox', { name: 'Nome', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'CEP', hidden: true })).toBeInTheDocument()
    expect(screen.getByLabelText(/granularidade dos horários/i)).toBeInTheDocument()
  })

  it('submits every step field through the single form action', async () => {
    cepLookup.result.data = {
      postalCode: '01310100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
    }
    const { createUnit } = await import('@/features/units/adapters/units.actions')
    vi.mocked(createUnit).mockResolvedValueOnce({ ok: true })
    render(
      <UnitCreateWizard
        defaults={{ businessHours: { ...EMPTY_BUSINESS_HOURS, monday: [WEEKDAY_RANGE] } }}
      />,
    )

    await fillIdentity()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'CEP' }), '01310-100')
    await userEvent.type(screen.getByRole('textbox', { name: 'Número' }), '123')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(screen.getByText('Escolha como a unidade atende pra continuar.')).toBeVisible()
    await userEvent.click(screen.getByRole('radio', { name: /Ordem de chegada/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar unidade' }))

    expect(createUnit).toHaveBeenCalledTimes(1)
    const formData = vi.mocked(createUnit).mock.calls[0]?.[0]
    expect(formData?.get('name')).toBe('Filial Centro')
    expect(formData?.get('postalCode')).toBe('01310-100')
    expect(formData?.get('hoursMode')).toBe('fixed')
    expect(formData?.get('bh_monday_0_open')).toBe('09:00')
    cepLookup.result.data = null
  })
})

describe('UnitCreateWizard — conscious mode choice (AC-06..09, #1401)', () => {
  it('renders the 3 modes as radio cards with no preselection', () => {
    render(<UnitCreateWizard />)
    for (const name of [/Por agendamento/, /Ordem de chegada/, /Sempre aberto/]) {
      expect(screen.getByRole('radio', { name, hidden: true })).toHaveAttribute(
        'data-state',
        'unchecked',
      )
    }
    expect(
      screen.getByText('Clientes marcam horário. A Agenda aparece no seu menu.'),
    ).toBeInTheDocument()
  })

  it('grows the stepper from 4 to 5 steps when appointment mode is chosen, and back', async () => {
    render(<UnitCreateWizard />)
    expect(screen.getByText('Passo 1 de 4')).toBeVisible()
    await userEvent.click(screen.getByRole('radio', { name: /Por agendamento/, hidden: true }))
    expect(screen.getByText('Passo 1 de 5')).toBeVisible()
    await userEvent.click(screen.getByRole('radio', { name: /Sempre aberto/, hidden: true }))
    expect(screen.getByText('Passo 1 de 4')).toBeVisible()
  })

  it('hides the weekly grid in always_open mode and before any choice', async () => {
    render(<UnitCreateWizard />)
    expect(screen.queryByLabelText('Segunda')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Sempre aberto/, hidden: true }))
    expect(screen.queryByLabelText('Segunda')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Ordem de chegada/, hidden: true }))
    expect(screen.getByLabelText('Segunda', { selector: 'button' })).toBeInTheDocument()
  })
})

describe('UnitCreateWizard — @/username field (AC-10..12, #1402)', () => {
  it('presents the field as Nome de usuário with the @ prefix and no "slug" copy', () => {
    render(<UnitCreateWizard />)
    expect(screen.getByRole('textbox', { name: 'Nome de usuário' })).toBeInTheDocument()
    expect(screen.getByText('@')).toBeInTheDocument()
    expect(screen.queryByText(/slug/i)).not.toBeInTheDocument()
  })

  it('previews the real public link in the org→unit hierarchy as the user types the name', async () => {
    render(<UnitCreateWizard />)
    expect(screen.getByText(/\/barbearia-x\/sua-unidade$/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Nome' }), 'Filial Centro')
    expect(screen.getByText(/\/barbearia-x\/filial-centro$/)).toBeInTheDocument()
  })

  it('auto-derives the @ from the name while untouched (AC-11)', async () => {
    render(<UnitCreateWizard />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Nome' }), 'Filial Centro Velho')
    expect(screen.getByRole('textbox', { name: 'Nome de usuário' })).toHaveValue(
      'filial-centro-velho',
    )
  })

  it('locks Continuar and shows the taken hint when the @ is unavailable (AC-12)', async () => {
    const { checkUnitSlugAvailability } = await import('@/features/units/adapters/units.actions')
    vi.mocked(checkUnitSlugAvailability).mockResolvedValue({
      ok: true,
      available: false,
      reason: 'taken',
    })
    render(<UnitCreateWizard />)
    await fillIdentity()
    expect(
      await screen.findByText('Este @ já está em uso por outra unidade desta empresa.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    vi.mocked(checkUnitSlugAvailability).mockResolvedValue({ ok: true, available: true })
  })
})

async function goToReview(modeName: RegExp = /Ordem de chegada/) {
  cepLookup.result.data = {
    postalCode: '01310100',
    state: 'SP',
    city: 'São Paulo',
    neighborhood: 'Bela Vista',
    street: 'Avenida Paulista',
  }
  render(
    <UnitCreateWizard
      defaults={{ businessHours: { ...EMPTY_BUSINESS_HOURS, monday: [WEEKDAY_RANGE] } }}
    />,
  )
  await fillIdentity()
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'CEP' }), '01310-100')
  await userEvent.type(screen.getByRole('textbox', { name: 'Número' }), '123')
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  await userEvent.click(screen.getByRole('radio', { name: modeName }))
  const continueButtons = () => screen.queryAllByRole('button', { name: 'Continuar' })
  while (continueButtons().length > 0) {
    const btn = continueButtons()[0]
    if (!btn || btn.hasAttribute('disabled')) break
    await userEvent.click(btn)
  }
}

describe('UnitCreateWizard — review step (AC-14..19)', () => {
  it('shows the per-section summary with Editar navigation preserving state (AC-18)', async () => {
    await goToReview()
    expect(screen.getByText('Filial Centro')).toBeInTheDocument()
    expect(screen.getByText(/@filial-centro/)).toBeInTheDocument()
    expect(screen.getByText(/Avenida Paulista, 123/)).toBeInTheDocument()
    expect(screen.getByText(/Ordem de chegada \/ balcão · 1 dia/)).toBeInTheDocument()

    const editButtons = screen.getAllByRole('button', { name: 'Editar' })
    expect(editButtons.length).toBeGreaterThanOrEqual(3)
    const identityEdit = editButtons[0]
    if (!identityEdit) throw new Error('missing Editar button')
    await userEvent.click(identityEdit)
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Filial Centro')
  })

  it('shows no cost block and a plain CTA when creation is free (AC-16)', async () => {
    await goToReview()
    expect(screen.queryByText('Custo adicional desta unidade')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar unidade' })).toBeEnabled()
  })

  it('locks the CTA behind the cost acknowledgement when charged (AC-14/15)', async () => {
    const { getUnitAdditionCostPreview } = await import('@/features/units/adapters/units.actions')
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: {
        charged: true,
        preview: {
          prorationCents: 1650,
          newMonthlyDeltaCents: 2990,
          newTotalMonthlyCents: 7980,
          currency: 'brl',
        },
      },
    })
    await goToReview()
    expect(screen.getByText('Custo adicional desta unidade')).toBeVisible()
    expect(screen.getByText(/16,50/)).toBeVisible()
    expect(screen.getByText(/29,90\/mês/)).toBeVisible()
    expect(screen.getByText(/79,80\/mês/)).toBeVisible()
    const cta = screen.getByRole('button', { name: 'Confirmar e criar unidade' })
    expect(cta).toBeDisabled()
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Entendi e concordo com a cobrança adicional/ }),
    )
    expect(cta).toBeEnabled()
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: { charged: false },
    })
  })

  it('degrades to a qualitative warning while keeping the acknowledgement (AC-17)', async () => {
    const { getUnitAdditionCostPreview } = await import('@/features/units/adapters/units.actions')
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: { charged: true, preview: null },
    })
    await goToReview()
    expect(screen.getByText(/o valor exato aparecerá na fatura/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirmar e criar unidade' })).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Entendi e concordo com a cobrança adicional/ }),
    ).toBeInTheDocument()
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: { charged: false },
    })
  })

  it('re-renders the summary after switching mode via Editar (AC-19)', async () => {
    await goToReview(/Por agendamento/)
    expect(screen.getByText(/Slots de \d+ min/)).toBeInTheDocument()

    const sections = screen.getAllByRole('button', { name: 'Editar' })
    const hoursEdit = sections[2]
    if (!hoursEdit) throw new Error('missing Editar button')
    await userEvent.click(hoursEdit)
    await userEvent.click(screen.getByRole('radio', { name: /Ordem de chegada/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.queryByText(/Slots de \d+ min/)).not.toBeInTheDocument()
    expect(screen.getByText(/Ordem de chegada \/ balcão · 1 dia/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nome', hidden: true })).toHaveValue('Filial Centro')
  })
})

describe('UnitCreateWizard — telemetry (AC-21)', () => {
  it('tracks opened on mount and step_completed on each advance', async () => {
    const { trackUnitWizardEvent } = await import('@/features/units/adapters/units.actions')
    vi.mocked(trackUnitWizardEvent).mockClear()
    const { unmount } = render(<UnitCreateWizard />)
    expect(trackUnitWizardEvent).toHaveBeenCalledWith({ event: 'opened' })

    await fillIdentity()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(trackUnitWizardEvent).toHaveBeenCalledWith({
      event: 'step_completed',
      step: 'identity',
      mode: null,
    })

    unmount()
    expect(trackUnitWizardEvent).toHaveBeenCalledWith({
      event: 'abandoned',
      lastStep: 'address',
    })
  })

  it('tracks cost_acknowledged when the acceptance is checked', async () => {
    const { getUnitAdditionCostPreview, trackUnitWizardEvent } =
      await import('@/features/units/adapters/units.actions')
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: { charged: true, preview: null },
    })
    await goToReview()
    vi.mocked(trackUnitWizardEvent).mockClear()
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Entendi e concordo com a cobrança adicional/ }),
    )
    expect(trackUnitWizardEvent).toHaveBeenCalledWith({ event: 'cost_acknowledged' })
    vi.mocked(getUnitAdditionCostPreview).mockResolvedValue({
      ok: true,
      cost: { charged: false },
    })
  })
})

describe('UnitCreateWizard — dirty tracking (AC-05)', () => {
  it('reports dirty once the user types anything', async () => {
    const onDirtyChange = vi.fn()
    render(<UnitCreateWizard onDirtyChange={onDirtyChange} />)
    expect(onDirtyChange).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Nome' }), 'F')
    expect(onDirtyChange).toHaveBeenCalledWith(true)
  })
})
