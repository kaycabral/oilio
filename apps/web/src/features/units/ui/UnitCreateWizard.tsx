'use client'

import { AddressFields } from '@/components/address-fields'
import { type BusinessHours, type UnitHoursMode } from '@/domain'
import { createUnit } from '@/features/units/adapters/units.actions'
import { BusinessHoursFields } from '@/features/units/ui/BusinessHoursFields'
import { UnitAgendaConfigFields } from '@/features/units/ui/UnitAgendaConfigFields'
import {
  slugBlocksSubmit,
  UnitIdentityFields,
  type SlugState,
} from '@/features/units/ui/UnitIdentityFields'
import { useStepValidity } from '@/hooks/use-step-validity'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  FieldDescription,
  FieldError,
  FieldGroup,
  Stepper,
} from '@cbrl/design'
import { useMemo, useState, useTransition } from 'react'

export type WizardStepId = 'identity' | 'address' | 'hours' | 'agenda' | 'review'

const STEP_LABELS: Record<WizardStepId, string> = {
  identity: 'Identidade',
  address: 'Endereço',
  hours: 'Funcionamento',
  agenda: 'Agenda',
  review: 'Revisão',
}

export function wizardSteps(mode: UnitHoursMode | null): WizardStepId[] {
  return mode === 'appointment'
    ? ['identity', 'address', 'hours', 'agenda', 'review']
    : ['identity', 'address', 'hours', 'review']
}

export function UnitCreateWizard({
  defaults,
  onDirtyChange,
}: {
  defaults?: { businessHours?: BusinessHours }
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<UnitHoursMode | null>('fixed')
  const [activeStep, setActiveStep] = useState<WizardStepId>('identity')
  const [dirty, setDirty] = useState(false)
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' })

  const steps = useMemo(() => wizardSteps(mode), [mode])
  const activeIndex = steps.indexOf(activeStep)

  const identity = useStepValidity<HTMLDivElement>()
  const address = useStepValidity<HTMLDivElement>()
  const hours = useStepValidity<HTMLDivElement>()
  const agenda = useStepValidity<HTMLDivElement>()

  const stepValidity: Record<WizardStepId, ReturnType<typeof useStepValidity> | null> = {
    identity,
    address,
    hours,
    agenda: mode === 'appointment' ? agenda : null,
    review: null,
  }

  const slugBlocked = slugBlocksSubmit(slugState)
  const current = stepValidity[activeStep]
  const currentValid =
    (current === null || current.isValid) && !(activeStep === 'identity' && slugBlocked)
  const allValid =
    !slugBlocked &&
    steps.every((s) => {
      const v = stepValidity[s]
      return v === null || v.isValid
    })

  function refreshAll() {
    identity.refresh()
    address.refresh()
    hours.refresh()
    agenda.refresh()
  }

  function onFormInteraction() {
    refreshAll()
    if (dirty) return
    setDirty(true)
    onDirtyChange?.(true)
  }

  function goTo(index: number) {
    const target = steps[index]
    if (!target) return
    setActiveStep(target)
    refreshAll()
  }

  function goNext() {
    if (activeIndex < steps.length - 1) goTo(activeIndex + 1)
  }

  function goBack() {
    if (activeIndex > 0) goTo(activeIndex - 1)
  }

  function onModeChange(next: UnitHoursMode) {
    setMode(next)
    if (activeStep === 'agenda' && next !== 'appointment') setActiveStep('hours')
  }

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createUnit(formData)
      if (!res.ok) setError(res.error)
    })
  }

  const isFinal = activeStep === 'review'

  return (
    <form action={onSubmit} onInput={onFormInteraction} onChange={onFormInteraction}>
      <div className="flex flex-col gap-6">
        <Stepper
          steps={steps.map((s) => STEP_LABELS[s])}
          activeIndex={activeIndex}
          onStepSelect={goTo}
        />

        <div ref={identity.panelRef} hidden={activeStep !== 'identity'}>
          <FieldGroup>
            <UnitIdentityFields onSlugStateChange={setSlugState} />
          </FieldGroup>
        </div>

        <div ref={address.panelRef} hidden={activeStep !== 'address'}>
          <FieldGroup>
            <AddressFields defaults={null} simplified numberRequired />
          </FieldGroup>
        </div>

        <div ref={hours.panelRef} hidden={activeStep !== 'hours'}>
          <FieldGroup>
            <BusinessHoursFields
              defaults={defaults?.businessHours ?? null}
              mode={mode ?? 'fixed'}
              onModeChange={onModeChange}
            />
          </FieldGroup>
        </div>

        <div ref={agenda.panelRef} hidden={activeStep !== 'agenda'}>
          <FieldGroup>
            <UnitAgendaConfigFields />
          </FieldGroup>
        </div>

        <div hidden={activeStep !== 'review'}>
          <FieldDescription>
            Revise os dados nos passos anteriores e crie a unidade.
          </FieldDescription>
        </div>

        {error ? <FieldError>{error}</FieldError> : null}

        {!currentValid && current?.firstInvalidLabel ? (
          <FieldDescription className="text-right">
            Preencha “{current.firstInvalidLabel}” para continuar.
          </FieldDescription>
        ) : null}

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={activeIndex === 0}>
            Voltar
          </Button>
          {isFinal ? (
            <Button type="submit" disabled={pending || !allValid}>
              {pending ? 'Criando…' : 'Criar unidade'}
            </Button>
          ) : (
            <Button type="button" onClick={goNext} disabled={!currentValid}>
              Continuar
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

export function DiscardConfirmDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar unidade?</AlertDialogTitle>
          <AlertDialogDescription>
            Você preencheu dados que ainda não foram salvos. Fechar agora descarta tudo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Descartar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
