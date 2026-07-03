'use client'

import { type Role, roleDescription, roleLabel } from '@/domain'
import { createInvite } from '@/features/team/adapters/team.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useState, useTransition } from 'react'

const INVITABLE_ROLES: Role[] = ['manager', 'member_operator', 'receptionist']

export function InviteForm() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ link: string; whatsappHref: string } | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  // Track the selected role so the dialog can explain what the invitee will be
  // able to do (refino): the privileges granted update with the selection.
  const [role, setRole] = useState<Role | ''>('')

  function onSubmit(formData: FormData) {
    setError(null)
    setInvite(null)
    startTransition(async () => {
      const result = await createInvite(formData)
      if (!result.ok) setError(result.error)
      else setInvite({ link: result.inviteLink, whatsappHref: result.whatsappHref })
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-3"
    >
      <div className="flex gap-2">
        <Input
          name="whatsapp"
          type="tel"
          required
          placeholder="WhatsApp — (11) 90000-0000"
          className="flex-1"
        />
        <Label htmlFor="invite-role" className="sr-only">
          Papel
        </Label>
        <Select
          name="role"
          required
          value={role || undefined}
          onValueChange={(value) => {
            const next = INVITABLE_ROLES.find((r) => r === value)
            if (next) setRole(next)
          }}
        >
          <SelectTrigger id="invite-role" className="w-40 shrink-0">
            <SelectValue placeholder="Papel" />
          </SelectTrigger>
          <SelectContent>
            {INVITABLE_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? 'Convidando…' : 'Convidar'}
        </Button>
      </div>

      {/* Explain the privileges being granted (refino): what the invitee will
          be able to do, updating with the selected role. */}
      {role ? (
        <p className="text-muted-foreground text-sm" role="note" aria-label="Permissões do papel">
          <span className="font-medium">{roleLabel(role)}:</span> {roleDescription(role)}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Escolha o papel para ver o que o convidado poderá fazer.
        </p>
      )}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {invite ? (
        <div className="border-border flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">Convite criado. Envie pelo WhatsApp:</p>
          <a
            href={invite.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 font-medium"
          >
            Enviar convite por WhatsApp
          </a>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Ou copie o link</summary>
            <code className="mt-1 block break-all">{invite.link}</code>
          </details>
        </div>
      ) : null}
    </form>
  )
}
