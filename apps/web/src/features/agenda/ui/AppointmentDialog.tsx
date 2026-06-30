'use client'

import { PhoneInput } from '@/components/PhoneInput'
import {
  formatBrazilPhone,
  type Appointment,
  type CatalogServiceItem,
  type Customer,
  type HoursRange,
  type MemberOperation,
  type SlotMinutes,
} from '@/domain'
import { createAppointment, updateAppointment } from '@/features/agenda/adapters/agenda.actions'
import {
  buildAppointmentWhatsappLink,
  gridTimeOptions,
  resolveInitialDateTime,
} from '@/features/agenda/core/appointment-dialog'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { AppointmentStatusActions, CancelConfirmForm } from './AppointmentStatusActions'

type CustomerMode = 'existing' | 'new'

const MAIN_FORM_ID = 'appointment-dialog-main-form'

export function AppointmentDialog({
  open,
  onOpenChange,
  unitId,
  memberOperations,
  services,
  customers,
  date,
  timezone,
  slotMinutes,
  dayHours,
  defaultMemberOperationId,
  defaultStartTime,
  appointment,
  businessName,
  confirmationTemplate,
  selfMemberOperationId = null,
  canRegisterCustomer = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unitId: string
  memberOperations: MemberOperation[]
  services: CatalogServiceItem[]
  customers: Customer[]
  date: string
  timezone: string
  // The unit's slot grid + the active day's open ranges — drive the time picker
  // so it only offers grid-valid starts (brief 0080, AC-03b).
  slotMinutes: SlotMinutes
  dayHours: readonly HoursRange[]
  defaultMemberOperationId?: string
  defaultStartTime?: string
  // When provided, dialog is in edit mode; submit calls updateAppointment.
  appointment?: Appointment | null
  businessName: string
  confirmationTemplate: string
  // #1257: a self-scoped memberOperation books only for themselves — the picker is
  // replaced by a fixed hidden input carrying this id. Null = balcão (full picker).
  selfMemberOperationId?: string | null
  // #1255 AC-05: only the balcão may register a customer inline. When false, the
  // "Cadastrar novo" toggle is hidden (the server action also refuses it).
  canRegisterCustomer?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [customerMode, setCustomerMode] = useState<CustomerMode>('existing')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const { formRef, isValid, refresh } = useFormValidity()

  const editMode = appointment !== undefined && appointment !== null

  useEffect(() => {
    if (!open) {
      setError(null)
      setCustomerMode('existing')
      setConfirmingCancel(false)
    }
  }, [open])

  const activeServices = useMemo(() => services.filter((s) => s.active), [services])
  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [customers],
  )

  const { date: initialDate, startTime: initialStartTime } = useMemo(
    () => resolveInitialDateTime(appointment, date, defaultStartTime, timezone),
    [appointment, date, defaultStartTime, timezone],
  )

  // Grid-valid start times for the active day (brief 0080, AC-03b). When editing
  // an appointment whose start no longer matches the grid (policy/hours changed
  // after it was booked), keep its current time selectable so the edit doesn't
  // silently drop it.
  const startTimeOptions = useMemo(() => {
    const grid = gridTimeOptions(dayHours, slotMinutes)
    if (initialStartTime && !grid.includes(initialStartTime)) {
      return [...grid, initialStartTime].sort((a, b) => a.localeCompare(b))
    }
    return grid
  }, [dayHours, slotMinutes, initialStartTime])

  const whatsappLink = useMemo(
    () =>
      buildAppointmentWhatsappLink({
        appointment,
        customers,
        services,
        memberOperations,
        timezone,
        confirmationTemplate,
        businessName,
      }),
    [
      appointment,
      customers,
      services,
      memberOperations,
      timezone,
      confirmationTemplate,
      businessName,
    ],
  )

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = editMode
        ? await updateAppointment(appointment.id, formData)
        : await createAppointment(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      router.refresh()
    })
  }

  // No-show button gate: only after the scheduled start instant. Before that,
  // the slot isn't "missed" yet — the path to free it is cancel. Wiki:
  // 04-Roadmap-Politica-Cancelamento § Quando o botão libera.
  const canMarkNoShow =
    editMode &&
    appointment.status === 'scheduled' &&
    new Date(appointment.startAt).getTime() <= Date.now()

  // ── Action forms (progressive enhancement) ─────────────────────────────
  // Each transactional action lives in its OWN <form>, *sibling* to the main
  // create/update form (HTML forms can't nest). Buttons are type="submit" so
  // clicks post natively even before React hydrates — kills the dialog
  // hydration race that #763 documented. `useActionState` reflects pending /
  // error / success back into the UI so the JS-on path keeps the existing
  // dialog-close-on-success ergonomics.

  const handleClose = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editMode ? 'Editar agendamento' : 'Novo agendamento'}</DialogTitle>
          <DialogDescription>
            {editMode
              ? 'Altere os campos para reagendar, ou cancele este agendamento.'
              : 'Preencha cliente, serviço, profissional e horário.'}
          </DialogDescription>
        </DialogHeader>

        <form
          id={MAIN_FORM_ID}
          ref={formRef}
          action={onSubmit}
          onInput={refresh}
          onChange={refresh}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="customerMode" value={customerMode} />

          <div className="flex flex-col gap-1">
            <Label htmlFor="appointment-service" className="text-sm font-medium">
              Serviço
            </Label>
            <Select name="serviceId" required defaultValue={appointment?.serviceId || undefined}>
              <SelectTrigger id="appointment-service">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {activeServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="appointment-memberOperation" className="text-sm font-medium">
              Profissional
            </Label>
            {/* #1257: a self-scoped memberOperation books only for themselves — the
                picker offers ONLY their own option (pre-selected), so the submit
                always carries their id. The server action + RLS also enforce it.
                The balcão gets the full list. Uses the design Select either way
                (no hand-rolled primitive). */}
            <Select
              name="memberOperationId"
              required
              defaultValue={
                selfMemberOperationId ??
                appointment?.memberOperationId ??
                defaultMemberOperationId ??
                undefined
              }
            >
              <SelectTrigger id="appointment-memberOperation">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(selfMemberOperationId
                  ? memberOperations.filter((p) => p.id === selfMemberOperationId)
                  : memberOperations
                ).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="appointment-customer" className="text-sm font-medium">
              Cliente
            </Label>
            {!editMode && canRegisterCustomer ? (
              <button
                type="button"
                onClick={() => setCustomerMode(customerMode === 'existing' ? 'new' : 'existing')}
                className="text-primary text-xs hover:underline"
              >
                {customerMode === 'existing' ? '+ Cadastrar novo' : '← Usar existente'}
              </button>
            ) : null}
          </div>

          {customerMode === 'existing' ? (
            <Select name="customerId" required defaultValue={appointment?.customerId || undefined}>
              <SelectTrigger id="appointment-customer">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {sortedCustomers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {formatBrazilPhone(c.whatsapp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Input name="newCustomerName" placeholder="Nome" required minLength={2} />
              <PhoneInput name="newCustomerWhatsapp" required />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="appointment-date" className="text-sm font-medium">
                Data
              </Label>
              <Input
                id="appointment-date"
                type="date"
                name="date"
                defaultValue={initialDate}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="appointment-startTime" className="text-sm font-medium">
                Início
              </Label>
              <Select name="startTime" required defaultValue={initialStartTime || undefined}>
                <SelectTrigger id="appointment-startTime">
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {startTimeOptions.length === 0 ? (
                    <SelectItem value={initialStartTime || '09:00'} disabled>
                      Sem horários na grade
                    </SelectItem>
                  ) : (
                    startTimeOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </form>

        {editMode ? (
          <AppointmentStatusActions
            appointment={appointment}
            whatsappLink={whatsappLink}
            canMarkNoShow={canMarkNoShow}
            onClose={handleClose}
          />
        ) : null}

        <DialogFooter>
          {(() => {
            if (!editMode || appointment?.status !== 'scheduled') return null
            if (confirmingCancel) {
              return (
                <CancelConfirmForm
                  appointmentId={appointment.id}
                  onCancel={() => setConfirmingCancel(false)}
                  onSuccess={handleClose}
                />
              )
            }
            return (
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                onClick={() => setConfirmingCancel(true)}
                disabled={pending}
              >
                Cancelar agendamento
              </Button>
            )
          })()}
          <Button type="button" variant="ghost" onClick={handleClose} disabled={pending}>
            Fechar
          </Button>
          <Button type="submit" form={MAIN_FORM_ID} disabled={pending || !isValid}>
            {(() => {
              if (pending) return 'Salvando…'
              return editMode ? 'Salvar' : 'Agendar'
            })()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
