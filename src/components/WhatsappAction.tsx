'use client'

import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@cbrl/design'

import { formatBrazilPhone, whatsappUrl } from '@cbrl/br/phone'
import { WhatsappIcon } from '@cbrl/design'

export function WhatsappAction({ phone, label }: { phone: string; label?: string }) {
  const href = whatsappUrl(phone)
  if (!href) return null
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
          <a href={href} target="_blank" rel="noreferrer">
            <WhatsappIcon className="size-4" />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{display}</TooltipContent>
    </Tooltip>
  )
}
