'use client'

import { InviteLinkActions } from '@/components/InviteLinkActions'
import { PhoneInput } from '@/components/PhoneInput'
import { type Role, roleDescription, roleLabel } from '@/domain'
import { createInvite } from '@/features/team/adapters/team.actions'
import { normalizeBrazilMobile } from '@cbrl/br/phone'
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cbrl/design'
import { useMemo, useRef, useState } from 'react'

const INVITABLE_ROLES: Role[] = ['manager', 'member_operator', 'receptionist']

export function InviteForm({ orgId, baseUrl }: { orgId: string; baseUrl: string }) {
  const [rawPhone, setRawPhone] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ link: string; whatsappHref: string } | null>(null)
  const inviteRef = useRef<{ link: string; whatsappHref: string } | null>(null)

  const mobileValid = useMemo(() => normalizeBrazilMobile(rawPhone) !== null, [rawPhone])
  const ready = mobileValid && role !== ''

  function resolveLinkPreview(): string {
    if (invite) return invite.link
    if (ready) return `${baseUrl}/invites/${orgId}/••••••?token=••••••`
    return ''
  }
  const linkPreview = resolveLinkPreview()

  async function ensureLink(): Promise<string | null> {
    const current = inviteRef.current
    if (current) return current.link
    if (!ready) return null
    setError(null)
    const formData = new FormData()
    formData.set('mobile', rawPhone)
    formData.set('role', role)
    const result = await createInvite(formData)
    if (!result.ok) {
      setError(result.error)
      return null
    }
    const minted = { link: result.inviteLink, whatsappHref: result.whatsappHref }
    inviteRef.current = minted
    setInvite(minted)
    return result.inviteLink
  }

  function resolveSendHref(): string | null {
    return inviteRef.current?.whatsappHref ?? null
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="invite-mobile" className="text-sm font-medium">
            WhatsApp do convidado
          </Label>
          <PhoneInput
            id="invite-mobile"
            name="mobile"
            onValueChange={(masked) => {
              setRawPhone(masked)
              inviteRef.current = null
              setInvite(null)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-role" className="text-sm font-medium">
            Papel
          </Label>
          <Select
            value={role || undefined}
            onValueChange={(value) => {
              const next = INVITABLE_ROLES.find((r) => r === value)
              if (next) {
                setRole(next)
                inviteRef.current = null
                setInvite(null)
              }
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
        </div>
      </div>

      {role ? (
        <p className="text-muted-foreground text-sm" role="note" aria-label="Permissões do papel">
          <span className="font-medium">{roleLabel(role)}:</span> {roleDescription(role)}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Escolha o papel para ver o que o convidado poderá fazer.
        </p>
      )}

      <InviteLinkActions
        linkPreview={linkPreview}
        ready={ready}
        generated={invite !== null}
        onEnsure={ensureLink}
        resolveSendHref={resolveSendHref}
        generateLabel="Gerar e abrir no WhatsApp"
      />

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}
