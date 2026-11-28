'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { updateProfile } from '@/features/settings/adapters/profile.actions'
import { useSettingsReload } from '@/features/settings/ui/settings-modal-context'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, SettingRow, SettingRowGroup } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

// global `users/{uid}` profile; the write reflects live across every screen
export function EditProfileForm({
  defaultName,
  defaultMobile,
  defaultBirthDate,
}: {
  defaultName: string
  defaultMobile: string
  defaultBirthDate: string
}) {
  const uid = useId()
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
      if (reloadSection) reloadSection()
      else router.refresh()
    })
  }

  return (
    <form ref={formRef} action={onSubmit} onInput={refresh} onChange={refresh}>
      <SettingRowGroup>
        <SettingRow
          title="Nome completo"
          description="Como você aparece para sua equipe"
          htmlFor={`${uid}-profile-name`}
        >
          <Input
            id={`${uid}-profile-name`}
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
          htmlFor={`${uid}-profile-mobile`}
        >
          <PhoneInput
            id={`${uid}-profile-mobile`}
            name="mobile"
            defaultValue={defaultMobile}
            required
            className="sm:w-64"
          />
        </SettingRow>

        <SettingRow title="Data de nascimento" htmlFor={`${uid}-profile-birthDate`}>
          <DateField
            id={`${uid}-profile-birthDate`}
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
