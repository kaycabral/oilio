'use client'

import { useOrg } from '@/shared/org/org-context'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cbrl/design'
import { Building2, Check, ChevronsUpDown, Store } from 'lucide-react'
import { useState, useTransition } from 'react'

/**
 * Fixed top context switcher (brief 0029, AC-03/AC-05/AC-09). Shows
 * `org > unidade` and lets the user:
 *  - switch the active unit (writes the ephemeral cookie + revalidates), and
 *  - switch the active org when they belong to 2+ (resets the unit context).
 *
 * A single-unit member (`membership.unitId`) is locked (AC-05): the unit picker
 * is hidden and only the active unit label is shown. When the user belongs to a
 * single org the org picker is omitted; with a single unit the unit picker
 * collapses to a static label.
 */
export function UnitOrgSwitcher() {
  const { org, orgs, units, activeUnitId, unitLocked, setActiveUnit, setActiveOrg } = useOrg()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const activeUnit = units.find((u) => u.id === activeUnitId) ?? null
  const multiOrg = orgs.length >= 2
  const canSwitchUnit = !unitLocked && units.length >= 2
  // No actionable choice anywhere → render a static breadcrumb (still shows
  // "org > unidade" per AC-03, just not interactive).
  const interactive = multiOrg || canSwitchUnit

  const unitLabel = activeUnit?.name ?? 'Sem unidade'

  function onSelectUnit(unitId: string) {
    setOpen(false)
    startTransition(() => {
      void setActiveUnit(unitId)
    })
  }

  function onSelectOrg(orgId: string) {
    setOpen(false)
    startTransition(() => {
      void setActiveOrg(orgId)
    })
  }

  const breadcrumb = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="truncate font-medium">{org.name}</span>
      <span className="text-muted-foreground" aria-hidden>
        ›
      </span>
      <Store className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="text-muted-foreground truncate">{unitLabel}</span>
    </span>
  )

  if (!interactive) {
    return (
      <div
        className="flex h-9 max-w-[60vw] items-center px-2 text-sm md:max-w-sm"
        role="group"
        aria-label="Contexto da unidade"
        data-interactive="false"
      >
        {breadcrumb}
      </div>
    )
  }

  return (
    // `modal={false}`: this is a context switcher, not a modal. The default
    // modal behavior locks body scroll (`overflow: hidden`), which breaks the
    // `position: sticky` app header (the scroll container is `html`, not
    // `body`) — the trigger + menu jump off-screen while open. Non-modal drops
    // the scroll-lock, so the sticky header survives.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="max-w-[60vw] gap-2 md:max-w-sm"
          aria-label="Contexto da unidade"
          data-interactive="true"
        >
          {breadcrumb}
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {multiOrg && (
          <>
            <DropdownMenuLabel>Negócio</DropdownMenuLabel>
            {orgs.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => onSelectOrg(t.id)}>
                <Building2 className="size-4" aria-hidden />
                <span className="truncate">{t.name}</span>
                {t.id === org.id && <Check className="ml-auto size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
            {canSwitchUnit && <DropdownMenuSeparator />}
          </>
        )}
        {canSwitchUnit && (
          <>
            <DropdownMenuLabel>Unidade</DropdownMenuLabel>
            {units.map((u) => (
              <DropdownMenuItem key={u.id} onSelect={() => onSelectUnit(u.id)}>
                <Store className="size-4" aria-hidden />
                <span className="truncate">{u.name}</span>
                {u.id === activeUnitId && <Check className="ml-auto size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
