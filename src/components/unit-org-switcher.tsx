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

export function UnitOrgSwitcher() {
  const { org, orgs, units, activeUnitId, unitLocked, setActiveUnit, setActiveOrg } = useOrg()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const activeUnit = units.find((u) => u.id === activeUnitId) ?? null
  const multiOrg = orgs.length >= 2
  const canSwitchUnit = !unitLocked && units.length >= 2
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
