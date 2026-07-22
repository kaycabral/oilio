'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { isValidUnitSlug, SLUG_HTML_PATTERN, slugifyUnitName, type Unit } from '@/domain'
import { checkUnitSlugAvailability } from '@/features/units/adapters/units.actions'
import {
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@cbrl/design'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }

export function slugBlocksSubmit(state: SlugState): boolean {
  return state.kind === 'taken' || state.kind === 'invalid'
}

export function useUnitSlugField(unit: Unit | undefined, name: string) {
  const [slug, setSlug] = useState(unit?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' })

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

  return {
    slug,
    slugState,
    onSlugChange: (value: string) => {
      setSlug(value.toLowerCase())
      setSlugTouched(true)
    },
  }
}

export function UnitIdentityFields({
  unit,
  defaultName,
  onSlugStateChange,
}: {
  unit?: Unit
  defaultName?: string
  onSlugStateChange?: (state: SlugState) => void
}) {
  const [name, setName] = useState(unit?.name ?? defaultName ?? '')
  const { slug, slugState, onSlugChange } = useUnitSlugField(unit, name)

  useEffect(() => {
    onSlugStateChange?.(slugState)
  }, [slugState, onSlugStateChange])

  return (
    <>
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
      <UnitSlugField slug={slug} slugState={slugState} onSlugChange={onSlugChange} />
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
    </>
  )
}

export function UnitSlugField({
  slug,
  slugState,
  onSlugChange,
}: {
  slug: string
  slugState: SlugState
  onSlugChange: (value: string) => void
}) {
  const slugHint = slugStateToHint(slugState)
  return (
    <Field>
      <FieldLabel htmlFor="unit-slug" required>
        Slug público
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="unit-slug"
          name="slug"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
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
        <FieldDescription className={slugHint.tone === 'error' ? 'text-destructive' : undefined}>
          {slugHint.text}
        </FieldDescription>
      ) : null}
    </Field>
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
