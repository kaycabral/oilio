'use client'

import {
  type Appointment,
  type BlockSegment,
  type CatalogServiceItem,
  type Customer,
  type HoursRange,
  type Professional,
  SLOT_MINUTES_OPTIONS,
  type SlotMinutes,
  type Unit,
  getTodayInOrgTz,
  isValidSlotMinutes,
  shiftDateInOrgTz,
} from '@/domain'
import { updateAgendaSlotMinutes } from '@/features/agenda/adapters/agenda.actions'
import {
  Button,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
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
  timezone: string
  slotMinutes: SlotMinutes
  units: Unit[]
  activeUnitId: string | null
  professionals: Professional[]
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
}

export function AgendaView({
  date,
  timezone,
  slotMinutes,
  units,
  activeUnitId,
  professionals,
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
}: AgendaViewProps) {
  const router = useRouter()
  const today = getTodayInOrgTz(timezone)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [slotMinutesPending, startSlotMinutesTransition] = useTransition()
  const canCreate = activeUnitId !== null && professionals.length > 0 && services.length > 0

  function changeSlotMinutes(next: SlotMinutes) {
    if (next === slotMinutes) return
    startSlotMinutesTransition(async () => {
      const res = await updateAgendaSlotMinutes(next)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Granularidade: ${next} min`)
      router.refresh()
    })
  }

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

  function navigate(nextDate: string) {
    const sp = new URLSearchParams()
    sp.set('date', nextDate)
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
            variant="outline"
            size="sm"
            onClick={() => navigate(shiftDateInOrgTz(date, -1, timezone))}
          >
            ←
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(today)}
            disabled={date === today}
          >
            Hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(shiftDateInOrgTz(date, 1, timezone))}
          >
            →
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => navigate(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          />
          {canManage ? (
            <div
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
              title="Granularidade do grid e passo de agendamento"
            >
              <Label htmlFor="agenda-slot-minutes">Slots</Label>
              <Select
                value={String(slotMinutes)}
                disabled={slotMinutesPending}
                onValueChange={(value) => {
                  const next = Number(value)
                  if (isValidSlotMinutes(next)) changeSlotMinutes(next)
                }}
              >
                <SelectTrigger id="agenda-slot-minutes" className="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLOT_MINUTES_OPTIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
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
        if (professionals.length === 0) {
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
            professionals={professionals}
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
          professionals={professionals}
          services={services}
          customers={customers}
          date={date}
          timezone={timezone}
          appointment={selectedAppointment}
          businessName={businessName}
          confirmationTemplate={confirmationTemplate}
        />
      ) : null}
    </div>
  )
}
