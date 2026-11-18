'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@oilio/design'
import { Cake } from 'lucide-react'

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
