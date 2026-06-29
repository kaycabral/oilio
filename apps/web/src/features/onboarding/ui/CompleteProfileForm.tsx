'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { completeProfile } from '@/features/onboarding/adapters/complete-profile.actions'
import type { ProfilePrefill } from '@/features/onboarding/core/profile-form'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, Label } from '@cbrl/design'
import { useId, useState, useTransition } from 'react'

// Progressive profiling (brief 0077 #1277): every required field renders, but
// the ones the identity already gave us start pre-filled (editable, not
// re-asked) and the still-missing ones get a "Falta preencher" hint + autofocus.
// `prefill.missing` is the source of truth for which is which.
export function CompleteProfileForm({
  prefill,
  next,
  contextQuery = '',
}: {
  prefill: ProfilePrefill
  next: string
  // Materialize-at-completion context (#1278): a pre-built query string carrying
  // the establishment `from` slug + attribution axes, recovered from the return
  // URL by the page. Forwarded verbatim so the action can create the Customer.
  // Empty for a plain platform signup (no establishment context).
  contextQuery?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const ids = useId()
  const nameId = `${ids}-name`
  const whatsappId = `${ids}-whatsapp`
  const birthDateId = `${ids}-birthDate`

  const today = new Date().toISOString().slice(0, 10)
  const isMissing = (f: 'name' | 'whatsapp' | 'birthDate') => prefill.missing.includes(f)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await completeProfile(formData)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="next" value={next} />
      {contextQuery ? <input type="hidden" name="context" value={contextQuery} /> : null}
      <div className="flex flex-col gap-1">
        <Label htmlFor={nameId} className="text-sm font-medium">
          Nome {isMissing('name') ? <MissingHint /> : null}
        </Label>
        <Input id={nameId} name="name" defaultValue={prefill.name} required minLength={2} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={whatsappId} className="text-sm font-medium">
          WhatsApp {isMissing('whatsapp') ? <MissingHint /> : null}
        </Label>
        <PhoneInput id={whatsappId} name="whatsapp" defaultValue={prefill.whatsapp} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={birthDateId} className="text-sm font-medium">
          Data de nascimento {isMissing('birthDate') ? <MissingHint /> : null}
        </Label>
        <DateField
          id={birthDateId}
          name="birthDate"
          defaultValue={prefill.birthDate}
          required
          max={today}
          captionLayout="dropdown"
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending || !isValid}>
        {pending ? 'Salvando…' : 'Continuar'}
      </Button>
    </form>
  )
}

// Inline marker on a field the identity didn't pre-fill — tells the customer
// exactly what they still have to type (AC-08/AC-09).
function MissingHint() {
  return <span className="text-muted-foreground text-xs font-normal">· falta preencher</span>
}
