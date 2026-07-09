'use client'

import { AddressFields } from '@/components/address-fields'
import { PhoneInput } from '@/components/PhoneInput'
import {
  appointmentAgenda,
  type BusinessHours,
  isValidUnitSlug,
  SLUG_HTML_PATTERN,
  slugifyUnitName,
  type Unit,
  unitBusinessHours,
  type UnitHoursMode,
} from '@/domain'
import {
  checkUnitSlugAvailability,
  createUnit,
  updateUnit,
} from '@/features/units/adapters/units.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@cbrl/design'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { BusinessHoursFields } from './BusinessHoursFields'
import { UnitAgendaConfigFields } from './UnitAgendaConfigFields'

type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }

type UnitFormDefaults = {
  name?: string
  businessHours?: BusinessHours
}

export function UnitForm({ unit, defaults }: { unit?: Unit; defaults?: UnitFormDefaults }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, firstInvalidLabel, refresh } = useFormValidity()
  const [name, setName] = useState(unit?.name ?? defaults?.name ?? '')
  const [slug, setSlug] = useState(unit?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' })
  const [mode, setMode] = useState<UnitHoursMode>(unit?.agenda.mode ?? 'fixed')
  const priorAppointment = unit ? appointmentAgenda(unit.agenda) : null

  useEffect(() => {
    if (slugTouched) return
    setSlug(slugifyUnitName(name))
  }, [name, slugTouched])

  useEffect(() => {
    const candidate = slug.trim().toLowerCase()
    if (candidate.length === 0) {
      setSlugState({ kind: 'idle' })
      return
    }
    if (candidate === unit?.slug) {
      setSlugState({ kind: 'available' })
      return
    }
    if (!isValidUnitSlug(candidate)) {
      setSlugState({ kind: 'invalid' })
      return
    }
    setSlugState({ kind: 'checking' })
    let cancelled = false
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await checkUnitSlugAvailability(candidate, unit?.id ?? null)
          if (cancelled) return
          if (!res.ok) {
            setSlugState({ kind: 'error', message: res.error })
            return
          }
          if (res.available) setSlugState({ kind: 'available' })
          else if (res.reason === 'taken') setSlugState({ kind: 'taken' })
          else setSlugState({ kind: 'invalid' })
        } catch {
          if (cancelled) return
          setSlugState({ kind: 'error', message: 'Não foi possível verificar. Tente de novo.' })
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [slug, unit?.id, unit?.slug])

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = unit ? await updateUnit(unit.id, formData) : await createUnit(formData)
      if (!res.ok) setError(res.error)
    })
  }

  const slugHint = slugStateToHint(slugState)
  const submitBlocked = slugState.kind === 'taken' || slugState.kind === 'invalid'

  return (
    <form ref={formRef} action={onSubmit} onInput={refresh} onChange={refresh}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="unit-name" required>
            Nome
          </FieldLabel>
          <Input
            id="unit-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="unit-slug" required>
            Slug público
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="unit-slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase())
                setSlugTouched(true)
              }}
              placeholder="filial-centro"
              minLength={3}
              maxLength={64}
              pattern={SLUG_HTML_PATTERN}
              required
              aria-invalid={slugState.kind === 'taken' || slugState.kind === 'invalid'}
            />
            <InputGroupAddon>{renderSlugIcon(slugState.kind)}</InputGroupAddon>
          </InputGroup>
          {slugState.kind !== 'available' ? (
            <FieldDescription
              className={slugHint.tone === 'error' ? 'text-destructive' : undefined}
            >
              {slugHint.text}
            </FieldDescription>
          ) : null}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="unit-mobile" required>
              WhatsApp
            </FieldLabel>
            <PhoneInput id="unit-mobile" name="mobile" defaultValue={unit?.mobile ?? ''} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="unit-email">Email</FieldLabel>
            <Input
              id="unit-email"
              name="email"
              type="email"
              defaultValue={unit?.email ?? ''}
              placeholder="contato@unidade.com"
            />
          </Field>
        </div>
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

function renderSlugIcon(kind: SlugState['kind']) {
  switch (kind) {
    case 'available':
      return (
        <>
          <Check className="text-emerald-600" aria-hidden />
          <span className="sr-only">Slug disponível</span>
        </>
      )
    case 'checking':
      return <Loader2 className="text-muted-foreground animate-spin" aria-hidden />
    case 'taken':
    case 'invalid':
    case 'error':
      return <X className="text-destructive" aria-hidden />
    case 'idle':
      return null
  }
}

function slugStateToHint(state: SlugState): { text: string; tone: 'neutral' | 'ok' | 'error' } {
  switch (state.kind) {
    case 'idle':
      return {
        text: 'Aparece na URL pública. Use letras minúsculas, números e hífens.',
        tone: 'neutral',
      }
    case 'checking':
      return { text: 'Verificando disponibilidade…', tone: 'neutral' }
    case 'available':
      return { text: 'Disponível.', tone: 'ok' }
    case 'taken':
      return { text: 'Já em uso por outra unidade desta empresa.', tone: 'error' }
    case 'invalid':
      return {
        text: 'Slug inválido — 3–64 caracteres, letras minúsculas, números e hífens. Evite nomes reservados.',
        tone: 'error',
      }
    case 'error':
      return { text: state.message, tone: 'error' }
  }
}
