'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@cbrl/design'
import { Cake } from 'lucide-react'

// Birthday marker shown beside a person's name only on their birthday (gate with
// `isBirthdayToday`). Icon-only; the tooltip + `aria-label` explain it.
export function BirthdayIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground inline-flex shrink-0" aria-label="Aniversário hoje">
          <Cake className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Aniversário hoje 🎉</TooltipContent>
    </Tooltip>
  )
}
