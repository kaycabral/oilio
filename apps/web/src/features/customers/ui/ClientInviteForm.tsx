'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { recordClientInviteIssued } from '@/features/customers/adapters/customers.actions'
import { buildClientInviteWhatsapp } from '@/shared/invite/client-invite'
import { Button, Input, Label } from '@oilio/design'
import { Check, Copy } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.477-.207zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}

export function ClientInviteForm({
  unitSlug,
  baseUrl,
  orgSlug,
  orgName,
  actorId,
}: {
  unitSlug: string
  baseUrl: string
  orgSlug: string
  orgName: string
  actorId: string
}) {
  const [rawPhone, setRawPhone] = useState('')
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()

  const invite = useMemo(
    () =>
      buildClientInviteWhatsapp({
        rawPhone,
        baseUrl,
        orgName,
        invite: {
          orgSlug,
          unitSlug,
          intent: 'signup',
          attribution: {
            source: 'whatsapp',
            medium: 'invite',
            campaign: null,
            content: null,
            term: null,
            actorId,
            intent: 'signup',
          },
        },
      }),
    [rawPhone, baseUrl, orgName, orgSlug, unitSlug, actorId],
  )
  const ready = invite.ok

  function onCopy(url: string): void {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done))
    } else {
      fallbackCopy(url, done)
    }
  }

  function onSend(): void {
    if (!invite.ok) return
    window.open(invite.href, '_blank', 'noopener,noreferrer')
    startTransition(() => {
      void recordClientInviteIssued({ unitSlug })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="invite-whatsapp" className="text-sm font-medium">
          WhatsApp do cliente
        </Label>
        <PhoneInput id="invite-whatsapp" name="whatsapp" onValueChange={setRawPhone} />
      </div>

      {ready ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-stretch gap-2">
            <Input
              readOnly
              aria-label="Link do convite"
              value={invite.url}
              className="text-muted-foreground font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={copied ? 'Link copiado' : 'Copiar link'}
              onClick={() => onCopy(invite.url)}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <Button type="button" onClick={onSend}>
            <WhatsappIcon className="mr-2 h-4 w-4" />
            Abrir no WhatsApp
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function fallbackCopy(text: string, onDone: () => void): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    onDone()
  } finally {
    document.body.removeChild(ta)
  }
}
