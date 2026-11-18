'use client'

import { AddressFields } from '@/components/address-fields'
import {
  appointmentAgenda,
  unitBusinessHours,
  type BusinessHours,
  type Unit,
  type UnitHoursMode,
} from '@/domain'
import { createUnit, updateUnit } from '@/features/units/adapters/units.actions'
import { BusinessHoursFields } from '@/features/units/ui/BusinessHoursFields'
import { UnitAgendaConfigFields } from '@/features/units/ui/UnitAgendaConfigFields'
import {
  slugBlocksSubmit,
  UnitIdentityFields,
  type SlugState,
} from '@/features/units/ui/UnitIdentityFields'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSeparator,
} from '@cbrl/design'
import { useState, useTransition } from 'react'

type UnitFormDefaults = {
  name?: string
  businessHours?: BusinessHours
}

export function UnitForm({ unit, defaults }: { unit?: Unit; defaults?: UnitFormDefaults }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, firstInvalidLabel, refresh } = useFormValidity()
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' })
  const [mode, setMode] = useState<UnitHoursMode>(unit?.agenda.mode ?? 'fixed')
  const priorAppointment = unit ? appointmentAgenda(unit.agenda) : null

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = unit ? await updateUnit(unit.id, formData) : await createUnit(formData)
      if (!res.ok) setError(res.error)
    })
  }

  const submitBlocked = slugBlocksSubmit(slugState)

  return (
    <form ref={formRef} action={onSubmit} onInput={refresh} onChange={refresh}>
      <FieldGroup>
        <UnitIdentityFields
          unit={unit}
          defaultName={defaults?.name}
          onSlugStateChange={setSlugState}
        />
        <FieldSeparator />
        <AddressFields defaults={unit?.address ?? null} simplified numberRequired />
        <FieldSeparator />
        <BusinessHoursFields
          defaults={unit ? unitBusinessHours(unit.agenda) : (defaults?.businessHours ?? null)}
          mode={mode}
          onModeChange={setMode}
        />
        {mode === 'appointment' ? (
          <>
            <FieldSeparator />
            <UnitAgendaConfigFields
              slotMinutes={priorAppointment?.slotMinutes}
              cancellationPolicy={priorAppointment?.cancellationPolicy}
              confirmationTemplates={priorAppointment?.confirmationTemplates}
            />
          </>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        {!isValid && !pending && !submitBlocked && firstInvalidLabel ? (
          <FieldDescription className="text-right">
            Preencha “{firstInvalidLabel}” para {unit ? 'salvar' : 'criar'}.
          </FieldDescription>
        ) : null}
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={pending || !isValid || submitBlocked}>
            {(() => {
              if (pending) return 'Salvando…'
              return unit ? 'Salvar' : 'Criar'
            })()}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
