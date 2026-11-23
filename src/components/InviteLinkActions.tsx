'use client'

import { Button, Input, WhatsappIcon } from '@cbrl/design'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

export function InviteLinkActions({
  linkPreview,
  ready,
  generated,
  onEnsure,
  resolveSendHref,
  generateLabel,
}: {
  linkPreview: string
  ready: boolean
  generated: boolean
  onEnsure: () => Promise<string | null>
  resolveSendHref: () => string | null
  generateLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onCopy(): Promise<void> {
    if (!ready || busy) return
    setBusy(true)
    try {
      const link = generated ? linkPreview : await onEnsure()
      if (!link) return
      copyToClipboard(link, () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
    } finally {
      setBusy(false)
    }
  }

  async function onPrimary(): Promise<void> {
    if (!ready || busy) return
    setBusy(true)
    const popup = window.open('', '_blank')
    try {
      const link = generated ? linkPreview : await onEnsure()
      const href = link ? resolveSendHref() : null
      if (!href) {
        popup?.close()
        return
      }
      if (popup) {
        popup.opener = null
        popup.location.href = href
      }
    } finally {
      setBusy(false)
    }
  }

  const needsGenerate = !generated && generateLabel !== undefined
  const primaryLabel = needsGenerate ? generateLabel : 'Abrir no WhatsApp'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch gap-2">
        <Input
          readOnly
          aria-label="Link do convite"
          disabled={!generated}
          value={linkPreview}
          className="text-muted-foreground font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!ready || busy}
          aria-label={copied ? 'Link copiado' : 'Copiar link'}
          onClick={() => void onCopy()}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      <Button type="button" disabled={!ready || busy} onClick={() => void onPrimary()}>
        <WhatsappIcon className="mr-2 h-4 w-4" />
        {primaryLabel}
      </Button>
    </div>
  )
}

function copyToClipboard(text: string, onDone: () => void): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone, () => fallbackCopy(text, onDone))
  } else {
    fallbackCopy(text, onDone)
  }
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
