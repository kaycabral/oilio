'use client'

import { type Role, roleDescription } from '@/domain'
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

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  member_operator: 'Profissional',
  receptionist: 'Recepção',
}

export function InviteForm() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  // Track the selected role so the dialog can explain what the invitee will be
  // able to do (refino): the privileges granted update with the selection.
  const [role, setRole] = useState<Role | ''>('')

  function onSubmit(formData: FormData) {
    setError(null)
    setLink(null)
    startTransition(async () => {
      const result = await createInvite(formData)
      if (!result.ok) setError(result.error)
      else setLink(result.inviteLink)
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
          name="email"
          type="email"
          required
          placeholder="email@empresa.com"
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
                {ROLE_LABELS[r]}
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
          <span className="font-medium">{ROLE_LABELS[role]}:</span> {roleDescription(role)}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Escolha o papel para ver o que o convidado poderá fazer.
        </p>
      )}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {link ? (
        <div className="border-border rounded-md border p-3 text-sm">
          <p className="text-muted-foreground mb-1">Compartilhe o link com o convidado:</p>
          <code className="break-all">{link}</code>
        </div>
      ) : null}
    </form>
  )
}
