'use client'

import { InviteLinkActions } from '@/components/InviteLinkActions'
import { PhoneInput } from '@/components/PhoneInput'
import { normalizeBrazilMobile, type Role, roleDescription, roleLabel } from '@/domain'
import { createInvite } from '@/features/team/adapters/team.actions'
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cbrl/design'
import { useMemo, useState } from 'react'

const INVITABLE_ROLES: Role[] = ['manager', 'member_operator', 'receptionist']

// Member-invite surface, in parity with the client-invite modal (brief 0087,
// Grupo D). The owner types ONLY the invitee's mobile (masked) + the role; the
// link/copy/open-on-WhatsApp affordances are ALWAYS visible (via
// `InviteLinkActions`) so the modal never grows — they flip from disabled to
// enabled as the number becomes a valid BR mobile.
//
// Unlike the client invite (whose link is built client-side from pure core),
// the member link needs a server round-trip to mint the signed token (the role
// grant is a privilege — brief 0084). So `onEnsure` calls `createInvite`, which
// resolves the org + base URL server-side and returns the real link; until then
// the preview shows a placeholder token and stays disabled (not copyable).
export function InviteForm({ orgId, baseUrl }: { orgId: string; baseUrl: string }) {
  const [rawPhone, setRawPhone] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [error, setError] = useState<string | null>(null)
  // The minted invite (real token) — null until the owner generates it.
  const [invite, setInvite] = useState<{ link: string; whatsappHref: string } | null>(null)

  // Ready = a valid BR mobile is typed AND a role is picked. Same threshold the
  // old form used to enable submit; here it enables the affordances.
  const mobileValid = useMemo(() => normalizeBrazilMobile(rawPhone) !== null, [rawPhone])
  const ready = mobileValid && role !== ''

  // Live preview of the accept link. Before generation the token + invite id
  // aren't minted, so the preview carries placeholders (the field stays disabled
  // so this half-baked link can't be selected/copied). After generation it shows
  // the real link.
  function resolveLinkPreview(): string {
    if (invite) return invite.link
    if (ready) return `${baseUrl}/invites/${orgId}/••••••?token=••••••`
    return ''
  }
  const linkPreview = resolveLinkPreview()

  // Mint the invite server-side (round-trip) and cache it. Returns the real link
  // or null on failure. Called by copy/send before doing their thing.
  async function ensureLink(): Promise<string | null> {
    if (invite) return invite.link
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
    setInvite({ link: result.inviteLink, whatsappHref: result.whatsappHref })
    return result.inviteLink
  }

  function onSend(): void {
    // The minted invite exists by the time send runs (InviteLinkActions ensures
    // first). Open WhatsApp inside the click to dodge popup blockers.
    if (invite) window.open(invite.whatsappHref, '_blank', 'noopener,noreferrer')
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
              // A new number invalidates any already-minted link.
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

      {/* Explain the privileges being granted, updating with the selected role. */}
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
        onSend={onSend}
        generateLabel="Gerar e abrir no WhatsApp"
      />

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}
