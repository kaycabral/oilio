'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { recordClientInviteIssued } from '@/features/customers/adapters/customers.actions'
import { buildClientInviteWhatsapp } from '@/shared/invite/client-invite'
import { Button, Input, Label, WhatsappIcon } from '@cbrl/design'
import { Check, Copy } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'

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
