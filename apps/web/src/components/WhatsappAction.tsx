'use client'

import { formatBrazilPhone, normalizeBrazilPhone } from '@/domain'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@cbrl/design'

import { WhatsappIcon } from './icons/whatsapp'

// Exposed (always-visible) WhatsApp quick-action for a list row — sits beside the
// ⋯ menu. Opens wa.me for the number; the tooltip reveals the formatted number
// on hover. Renders nothing when the phone can't be normalized (no broken link).
export function WhatsappAction({ phone, label }: { phone: string; label?: string }) {
  const normalized = normalizeBrazilPhone(phone)
  if (!normalized) return null
  const display = formatBrazilPhone(phone)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label ?? `Abrir WhatsApp ${display}`}
        >
          <a href={`https://wa.me/${normalized}`} target="_blank" rel="noreferrer">
            <WhatsappIcon className="size-4" />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{display}</TooltipContent>
    </Tooltip>
  )
}
