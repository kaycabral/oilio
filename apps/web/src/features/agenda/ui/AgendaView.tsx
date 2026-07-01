'use client'

import {
  type Appointment,
  type BlockSegment,
  type CatalogServiceItem,
  type Customer,
  type HoursRange,
  type MemberOperation,
  type SlotMinutes,
  type Unit,
  getTodayInOrgTz,
  shiftDateInOrgTz,
} from '@/domain'
import { Button, EmptyState } from '@cbrl/design'
import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AgendaGrid } from './AgendaGrid'
import { AppointmentDialog } from './AppointmentDialog'

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export type AgendaViewProps = {
  date: string
  // Brief 0081 (#1312): URL-driven "mostrar cancelados" state. Off by default —
  // the read hides `cancelled`; on re-fetches the day with cancelled included so
  // the grid can split a shared slot.
  showCancelled: boolean
  timezone: string
  slotMinutes: SlotMinutes
  units: Unit[]
  activeUnitId: string | null
  memberOperations: MemberOperation[]
  appointments: Appointment[]
  customersById: Record<string, Customer>
  servicesById: Record<string, CatalogServiceItem>
  dayHours: readonly HoursRange[]
  hasBusinessHours: boolean
  blockSegments: readonly BlockSegment[]
  services: CatalogServiceItem[]
  customers: Customer[]
  businessName: string
  confirmationTemplate: string
  canManage: boolean
  selfMemberOperationId: string | null
  canManageCustomers: boolean
  // #1268: this self-scoped member's operational profile isn't provisioned yet —
  // the grid is empty by design (fail-closed). Render the explicit empty-state.
  memberOperationMissing: boolean
}

export function AgendaView({
  date,
  showCancelled,
  timezone,
  slotMinutes,
  units,
  activeUnitId,
  memberOperations,
  appointments,
  customersById,
  servicesById,
  dayHours,
  hasBusinessHours,
  blockSegments,
  services,
  customers,
  businessName,
  confirmationTemplate,
  canManage,
  selfMemberOperationId,
  canManageCustomers,
  memberOperationMissing,
}: AgendaViewProps) {
  const router = useRouter()
  const today = getTodayInOrgTz(timezone)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const canCreate = activeUnitId !== null && memberOperations.length > 0 && services.length > 0

  // The appointment-mode grid config for the active unit, or null when the unit
  // isn't in appointment mode (always_open/fixed) — there the dialog keeps a
  // free time input, since the backend enforces no grid there (brief 0080).
  const appointmentGrid = useMemo(() => {
    const active = units.find((u) => u.id === activeUnitId)
    if (!active || active.agenda.mode !== 'appointment') return null
    return { slotMinutes: active.agenda.slotMinutes, businessHours: active.agenda.businessHours }
  }, [units, activeUnitId])

  function openCreateDialog() {
    setSelectedAppointment(null)
    setDialogOpen(true)
  }

  function openEditDialog(appointment: Appointment) {
    setSelectedAppointment(appointment)
    setDialogOpen(true)
  }

  function handleDialogChange(open: boolean) {
    setDialogOpen(open)
    if (!open) setSelectedAppointment(null)
  }

  // Date and the `showCancelled` toggle (brief 0081 #1312) are both URL state.
  // Navigation preserves the other param so toggling cancelled doesn't reset the
  // day and changing the day doesn't drop the toggle.
  function navigate(next: { date?: string; showCancelled?: boolean }) {
    const sp = new URLSearchParams()
    sp.set('date', next.date ?? date)
    if (next.showCancelled ?? showCancelled) sp.set('showCancelled', '1')
    router.push(`/agenda?${sp.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={openCreateDialog}
            disabled={!canCreate}
            title={
              canCreate ? undefined : 'Cadastre uma unidade com profissional e serviço primeiro.'
            }
          >
            + Novo
          </Button>
          <Button
            variant={showCancelled ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={showCancelled}
            onClick={() => navigate({ showCancelled: !showCancelled })}
            title="Exibir também os agendamentos cancelados na grade"
          >
            {showCancelled ? 'Ocultar cancelados' : 'Mostrar cancelados'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ date: shiftDateInOrgTz(date, -1, timezone) })}
          >
            ←
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ date: today })}
            disabled={date === today}
          >
            Hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ date: shiftDateInOrgTz(date, 1, timezone) })}
          >
            →
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => navigate({ date: e.target.value })}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
      </header>

      <p className="text-muted-foreground text-sm capitalize">{formatDateLabel(date)}</p>

      {activeUnitId && !hasBusinessHours ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-50/60 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
          <span>
            Esta unidade ainda não tem horários de funcionamento. O grid mostra o dia inteiro como
            disponível.
          </span>
          {canManage ? (
            <Link
              href={`/units/${activeUnitId}`}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              Configurar horários
            </Link>
          ) : null}
        </div>
      ) : null}

      {(() => {
        // #1268: a self-scoped member without a provisioned operational profile.
        // Takes priority over the unit/member empty-states — the reads were
        // skipped fail-closed, so the grid would otherwise read as data loss.
        if (memberOperationMissing) {
          return (
            <EmptyState
              icon={<CalendarDays />}
              title="Seu perfil de agenda ainda não está pronto"
              description="Estamos finalizando a configuração do seu acesso à agenda. Isso costuma levar alguns instantes após o convite ser aceito. Se persistir, fale com a recepção para concluir seu cadastro."
              actionSlot={
                <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                  Atualizar
                </Button>
              }
            />
          )
        }
        if (units.length === 0) {
          return (
            <EmptyState
              icon={<CalendarDays />}
              title="Comece cadastrando uma unidade"
              description="A agenda precisa de uma unidade com horários de funcionamento para exibir os encaixes."
              actionSlot={<Link href={'/units/new'}>Cadastrar unidade</Link>}
            />
          )
        }
        if (memberOperations.length === 0) {
          return (
            <EmptyState
              icon={<CalendarDays />}
              title="Nenhum profissional nesta unidade"
              description="Vincule ao menos um profissional a esta unidade para abrir a agenda."
              actionSlot={<Link href={'/team'}>Convidar profissional</Link>}
            />
          )
        }
        return (
          <AgendaGrid
            memberOperations={memberOperations}
            appointments={appointments}
            customersById={customersById}
            servicesById={servicesById}
            date={date}
            timezone={timezone}
            slotMinutes={slotMinutes}
            dayHours={dayHours}
            hasBusinessHours={hasBusinessHours}
            blockSegments={blockSegments}
            onSelectAppointment={canCreate ? openEditDialog : undefined}
          />
        )
      })()}

      {canCreate && activeUnitId ? (
        <AppointmentDialog
          open={dialogOpen}
          onOpenChange={handleDialogChange}
          unitId={activeUnitId}
          memberOperations={memberOperations}
          services={services}
          customers={customers}
          date={date}
          timezone={timezone}
          appointmentGrid={appointmentGrid}
          appointment={selectedAppointment}
          businessName={businessName}
          confirmationTemplate={confirmationTemplate}
          selfMemberOperationId={selfMemberOperationId}
          canRegisterCustomer={canManageCustomers}
        />
      ) : null}
    </div>
  )
}
