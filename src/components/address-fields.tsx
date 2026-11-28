'use client'

import type { Address } from '@/domain'
import { useCepLookup } from '@/hooks/use-cep-lookup'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
} from '@cbrl/design'
import { useEffect, useId, useState } from 'react'

function formatCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function AddressFields({
  defaults,
  simplified = false,
  numberRequired = false,
}: {
  defaults?: Address | null
  simplified?: boolean
  numberRequired?: boolean
}) {
  const uid = useId()
  const [postalCode, setPostalCode] = useState(defaults?.postalCode ?? '')
  const lookup = useCepLookup(postalCode)
  const [state, setState] = useState(defaults?.state ?? '')
  const [city, setCity] = useState(defaults?.city ?? '')
  const [neighborhood, setNeighborhood] = useState(defaults?.neighborhood ?? '')
  const [street, setStreet] = useState(defaults?.street ?? '')

  useEffect(() => {
    if (lookup.data) {
      setState(lookup.data.state)
      setCity(lookup.data.city)
      setNeighborhood(lookup.data.neighborhood)
      if (lookup.data.street) setStreet(lookup.data.street)
    }
  }, [lookup.data])

  const hasLookupData = Boolean(state || city || neighborhood || street)
  const showRest = simplified ? hasLookupData : true

  return (
    <FieldSet>
      <FieldLegend>Endereço</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${uid}-addr-cep`} required>
            CEP
          </FieldLabel>
          <Input
            id={`${uid}-addr-cep`}
            name="postalCode"
            value={formatCep(postalCode)}
            onChange={(e) => setPostalCode(e.target.value)}
            inputMode="numeric"
            placeholder="00000-000"
            required
            maxLength={9}
          />
          {(() => {
            if (lookup.loading) return <FieldDescription>Consultando…</FieldDescription>
            if (lookup.error)
              return (
                <FieldDescription className="text-destructive">{lookup.error}</FieldDescription>
              )
            return null
          })()}
        </Field>

        {simplified && !showRest ? <PendingLookupConstraint /> : null}
        {(() => {
          if (!showRest) return null
          if (simplified) {
            return (
              <SimplifiedBody
                state={state}
                city={city}
                neighborhood={neighborhood}
                street={street}
                defaults={defaults ?? null}
                numberRequired={numberRequired}
              />
            )
          }
          return (
            <FullBody
              state={state}
              setState={setState}
              city={city}
              setCity={setCity}
              neighborhood={neighborhood}
              setNeighborhood={setNeighborhood}
              street={street}
              setStreet={setStreet}
              defaults={defaults ?? null}
              numberRequired={numberRequired}
            />
          )
        })()}
      </FieldGroup>
    </FieldSet>
  )
}

function PendingLookupConstraint() {
  return (
    <Input
      type="text"
      className="hidden"
      name="addressResolved"
      defaultValue=""
      required
      tabIndex={-1}
      aria-hidden
      aria-label="CEP"
    />
  )
}

function SimplifiedBody({
  state,
  city,
  neighborhood,
  street,
  defaults,
  numberRequired,
}: {
  state: string
  city: string
  neighborhood: string
  street: string
  defaults: Address | null
  numberRequired: boolean
}) {
  const uid = useId()
  return (
    <>
      <input type="hidden" name="state" value={state} required />
      <input type="hidden" name="city" value={city} required />
      <input type="hidden" name="neighborhood" value={neighborhood} required />
      <input type="hidden" name="street" value={street} required />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${uid}-addr-number-s`} required={numberRequired}>
            Número
          </FieldLabel>
          <Input
            id={`${uid}-addr-number-s`}
            name="number"
            defaultValue={defaults?.number ?? ''}
            placeholder={numberRequired ? 'Ex.: 123' : 'Opcional'}
            required={numberRequired}
          />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${uid}-addr-complement-s`}>Complemento</FieldLabel>
          <Input
            id={`${uid}-addr-complement-s`}
            name="complement"
            defaultValue={defaults?.complement ?? ''}
            placeholder="Opcional (sala, andar, etc.)"
          />
        </Field>
      </div>

      <FieldDescription className="truncate">
        {[street, neighborhood, city && state ? `${city}/${state}` : city || state]
          .filter(Boolean)
          .join(' · ')}
      </FieldDescription>
    </>
  )
}

function FullBody({
  state,
  setState,
  city,
  setCity,
  neighborhood,
  setNeighborhood,
  street,
  setStreet,
  defaults,
  numberRequired,
}: {
  state: string
  setState: (v: string) => void
  city: string
  setCity: (v: string) => void
  neighborhood: string
  setNeighborhood: (v: string) => void
  street: string
  setStreet: (v: string) => void
  defaults: Address | null
  numberRequired: boolean
}) {
  const uid = useId()
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Field>
          <FieldLabel htmlFor={`${uid}-addr-state`} required>
            Estado
          </FieldLabel>
          <Input
            id={`${uid}-addr-state`}
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
          />
        </Field>
        <Field className="md:col-span-3">
          <FieldLabel htmlFor={`${uid}-addr-city`} required>
            Cidade
          </FieldLabel>
          <Input
            id={`${uid}-addr-city`}
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${uid}-addr-neighborhood`} required>
          Bairro
        </FieldLabel>
        <Input
          id={`${uid}-addr-neighborhood`}
          name="neighborhood"
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={`${uid}-addr-street`} required>
          Logradouro
        </FieldLabel>
        <Input
          id={`${uid}-addr-street`}
          name="street"
          value={street}
          onChange={(e) => setStreet(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${uid}-addr-number`} required={numberRequired}>
            Número
          </FieldLabel>
          <Input
            id={`${uid}-addr-number`}
            name="number"
            defaultValue={defaults?.number ?? ''}
            placeholder={numberRequired ? 'Ex.: 123' : 'Opcional'}
            required={numberRequired}
          />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${uid}-addr-complement`}>Complemento</FieldLabel>
          <Input
            id={`${uid}-addr-complement`}
            name="complement"
            defaultValue={defaults?.complement ?? ''}
            placeholder="Opcional (sala, andar, etc.)"
          />
        </Field>
      </div>
    </>
  )
}
