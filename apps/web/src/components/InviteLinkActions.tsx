'use client'

import { Button, Input } from '@cbrl/design'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

// WhatsApp glyph — the action that matters on an invite surface is "send on
// WhatsApp", so it gets the brand mark on the primary button (no generic "send"
// icon competing). Shared between the client and member invite modals.
export function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.477-.207zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}

// Shared invite affordances: a read-only link preview + copy button + primary
// "open on WhatsApp" button. Rendered on both the client and member invite
// modals so the two surfaces read identically.
//
// The block is ALWAYS visible so the modal never grows/reflows — it flips from
// disabled to enabled as the number becomes valid. The link field shows a LIVE
// preview built as the number is typed; for the member flow the token isn't
// minted yet, so `linkPreview` carries a placeholder token (••••) and the field
// stays `disabled` (not just readOnly) — so the operator can't select/copy a
// half-baked link before it's real.
//
// `onEnsure` bridges the two flows: the client link is already final (returns
// it as-is), the member link needs a server round-trip to mint the token.
// Copy and Send both call it first, so a single click "generates and does the
// thing". `generateLabel` (only on the member flow) makes the primary button
// read "Gerar e abrir no WhatsApp" until the link exists, then "Abrir no
// WhatsApp".
export function InviteLinkActions({
  linkPreview,
  ready,
  generated,
  onEnsure,
  onSend,
  generateLabel,
}: {
  // Live preview of the link (with a placeholder token for the member flow).
  // Empty string until the number is valid.
  linkPreview: string
  // The number is valid — affordances enable.
  ready: boolean
  // The final link (real token) exists. Client flow: same as `ready`. Member
  // flow: only after "Gerar". Drives the copy button's ready state and whether
  // the primary button still needs to generate.
  generated: boolean
  // Ensures the FINAL link (mints the member token if needed) and returns it,
  // or null on failure. Called before copy/send. Client flow returns the link
  // synchronously; member flow does the round-trip.
  onEnsure: () => Promise<string | null>
  // Opens the wa.me deep link. Receives the ensured final link's href builder is
  // the caller's job — here we just notify; the caller opens WhatsApp (must be
  // inside the click to dodge popup blockers).
  onSend: () => void | Promise<void>
  // Member flow only: label for the primary button while the link isn't minted.
  // Omit for the client flow (button is always "Abrir no WhatsApp").
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
    try {
      const link = generated ? linkPreview : await onEnsure()
      if (!link) return
      await onSend()
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
          // Disabled (not just readOnly) until the FINAL link exists, so the
          // half-baked preview (stub token) can't be manually selected/copied
          // before it's real — the copy button (which generates first) is the
          // only way to get the link out until then.
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

// Copy with a guard for non-secure contexts (HTTP on a LAN host, where
// `navigator.clipboard` is undefined) — falls back to the legacy execCommand so
// "Copiar" never throws.
function copyToClipboard(text: string, onDone: () => void): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone, () => fallbackCopy(text, onDone))
  } else {
    fallbackCopy(text, onDone)
  }
}

// Last-resort clipboard for non-secure contexts: a hidden textarea + execCommand.
// Deprecated but the only thing that works over plain HTTP on a LAN host.
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
