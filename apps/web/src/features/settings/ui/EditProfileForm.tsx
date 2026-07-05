'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { updateProfile } from '@/features/settings/adapters/profile.actions'
import { useSettingsReload } from '@/features/settings/ui/settings-modal-context'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, SettingRow, SettingRowGroup } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// Self-service rectification form (brief 0032 / AC-06). Edits the subject's own
// global `users/{uid}` profile; the write reflects live across every screen
// (identity by reference). Pre-filled with the current values.
export function EditProfileForm({
  defaultName,
  defaultMobile,
  defaultBirthDate,
}: {
  defaultName: string
  defaultMobile: string
  defaultBirthDate: string
}) {
  const router = useRouter()
  const reloadSection = useSettingsReload()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  const today = new Date().toISOString().slice(0, 10)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Perfil atualizado.')
      // Inside the Configurações modal, reload just this section's data (no route
      // navigation — that would tear the modal down). On the full page there is
      // no provider, so fall back to a router refresh.
      if (reloadSection) reloadSection()
      else router.refresh()
    })
  }

  // Prototype layout (brief 0090 § Perfil): each field is a row with the label +
  // helper on the left and the control on the right. The control keeps its own
  // accessible name via the row's `htmlFor` binding, so it stays reachable by
  // label. The visible field width is capped so the inputs align like the mockup.
  return (
    <form ref={formRef} action={onSubmit} onInput={refresh} onChange={refresh}>
      <SettingRowGroup>
        <SettingRow
          title="Nome completo"
          description="Como você aparece para sua equipe"
          htmlFor="profile-name"
        >
          <Input
            id="profile-name"
            name="name"
            defaultValue={defaultName}
            required
            minLength={2}
            className="sm:w-64"
          />
        </SettingRow>

        <SettingRow
          title="Celular"
          description="Usado para login e notificações"
          htmlFor="profile-mobile"
        >
          <PhoneInput
            id="profile-mobile"
            name="mobile"
            defaultValue={defaultMobile}
            required
            className="sm:w-64"
          />
        </SettingRow>

        <SettingRow title="Data de nascimento" htmlFor="profile-birthDate">
          <DateField
            id="profile-birthDate"
            name="birthDate"
            defaultValue={defaultBirthDate}
            required
            max={today}
            captionLayout="dropdown"
            className="sm:w-64"
          />
        </SettingRow>
      </SettingRowGroup>

      {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}

      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  )
}
