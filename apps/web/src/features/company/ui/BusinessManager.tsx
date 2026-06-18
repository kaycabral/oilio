'use client'

import {
  isCompanyUnitFiscal,
  type Org,
  type Unit,
  type UnitHoursMode,
  type Vertical,
} from '@/domain'
import { CompanyForm } from '@/features/company/ui/CompanyForm'
import { NewOrgDialog } from '@/features/company/ui/NewOrgDialog'
import type { OrgOption } from '@/shared/org/org-context'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@cbrl/design'
import { Building2, ChevronDown, Settings2, Store } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'

const VERTICAL_LABELS: Record<Vertical, string> = {
  barbershop: 'Barbearia',
  auto_wash: 'Lavagem automotiva',
  auto_detailing: 'Estética automotiva',
  other: 'Outro',
}

const HOURS_MODE_LABELS: Record<UnitHoursMode, string> = {
  fixed: 'Horário fixo',
  always_open: 'Sempre aberto',
  appointment: 'Por agendamento',
}

function formatAddress(unit: Unit): string {
  const { street, number, city, state } = unit.address
  return `${street}${number ? `, ${number}` : ''} — ${city}/${state}`
}

// Folder-manager for the Negócios & Unidades surface (PRD Identidade v2, F5).
// Replaces the old "Empresa" page. The ACTIVE Negócio is expanded with its
// Unidades; other Negócios render as switchable rows (the multi-org invariant
// forbids reading their units here — switching makes one active, then it
// expands). For a single Negócio with a single Unidade it collapses to one
// simple card — no hierarchy shoved at users who don't need it.
export function BusinessManager({
  org,
  units,
  orgs,
  canManage,
}: {
  org: Org
  units: Unit[]
  orgs: OrgOption[]
  canManage: boolean
}) {
  const { setActiveOrg } = useOrg()
  const otherOrgs = orgs.filter((o) => o.id !== org.id)
  const collapsed = orgs.length <= 1 && units.length <= 1

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{collapsed ? 'Negócio' : 'Negócios & Unidades'}</h1>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={toRoute('/units/new')}>+ Nova unidade</Link>
            </Button>
            <NewOrgDialog />
          </div>
        ) : null}
      </header>

      <ActiveOrgCard org={org} units={units} canManage={canManage} showHeader={!collapsed} />

      {otherOrgs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">Outros negócios</h2>
          {otherOrgs.map((o) => (
            <OtherOrgRow key={o.id} orgOption={o} onOpen={setActiveOrg} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

function ActiveOrgCard({
  org,
  units,
  canManage,
  showHeader,
}: {
  org: Org
  units: Unit[]
  canManage: boolean
  showHeader: boolean
}) {
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      {showHeader ? (
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="text-muted-foreground size-4" aria-hidden />
            {org.name}
          </CardTitle>
          <Badge variant="secondary">{VERTICAL_LABELS[org.vertical]}</Badge>
        </CardHeader>
      ) : null}
      <CardContent className="space-y-4 pt-6">
        {canManage ? (
          <Collapsible open={editing} onOpenChange={setEditing}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <Settings2 className="size-4" aria-hidden />
                Configurações do negócio
                <ChevronDown
                  className="size-4 transition-transform data-[state=open]:rotate-180"
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <CompanyForm org={org} canManage={canManage} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Unidades</h3>
          {units.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma unidade ainda. Crie a primeira para começar a atender.
            </p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {units.map((unit) => (
                <UnitRow key={unit.id} unit={unit} canManage={canManage} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function UnitRow({ unit, canManage }: { unit: Unit; canManage: boolean }) {
  const formalized = isCompanyUnitFiscal(unit.fiscal)
  const content = (
    <span className="flex min-w-0 items-center gap-3 py-3">
      <Store className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{unit.name}</span>
        <span className="text-muted-foreground truncate text-xs">{formatAddress(unit)}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Badge variant="outline">{HOURS_MODE_LABELS[unit.agenda.mode]}</Badge>
        <Badge variant={formalized ? 'default' : 'secondary'}>
          {formalized ? 'Formalizada' : 'Informal'}
        </Badge>
      </span>
    </span>
  )

  if (!canManage) {
    return <li>{content}</li>
  }
  return (
    <li>
      <Link
        href={toRoute(`/units/${unit.id}`)}
        className="hover:bg-accent/40 -mx-2 flex rounded-md px-2 transition-colors"
      >
        {content}
      </Link>
    </li>
  )
}

function OtherOrgRow({
  orgOption,
  onOpen,
}: {
  orgOption: OrgOption
  onOpen: (orgId: string) => Promise<void>
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="truncate font-medium">{orgOption.name}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => void onOpen(orgOption.id))}
        >
          {pending ? 'Abrindo…' : 'Abrir'}
        </Button>
      </CardContent>
    </Card>
  )
}
