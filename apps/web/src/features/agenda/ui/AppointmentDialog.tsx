'use client'

import { PhoneInput } from '@/components/PhoneInput'
import {
  formatBrazilPhone,
  getBusinessHoursForDay,
  resolveCatalogItemForUnit,
  type Appointment,
  type BusinessHours,
  type CatalogServiceItem,
  type Customer,
  type MemberOperation,
  type SlotMinutes,
} from '@/domain'
import { createAppointment, updateAppointment } from '@/features/agenda/adapters/agenda.actions'
import {
  buildAppointmentWhatsappLink,
  filterGridByBusy,
  gridTimeOptions,
  resolveInitialDateTime,
  resolveStartTimePicker,
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
} from '@oilio/design'
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
  busyByMemberOperation = {},
  services,
  customers,
  date,
  timezone,
  appointmentGrid,
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
  busyByMemberOperation?: Record<string, Appointment[]>
  services: CatalogServiceItem[]
  customers: Customer[]
  date: string
  timezone: string
  appointmentGrid: { slotMinutes: SlotMinutes; businessHours: BusinessHours } | null
  defaultMemberOperationId?: string
  defaultStartTime?: string
  appointment?: Appointment | null
  businessName: string
  confirmationTemplate: string
  selfMemberOperationId?: string | null
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

  const initialMemberOperationId =
    selfMemberOperationId ?? appointment?.memberOperationId ?? defaultMemberOperationId ?? ''

  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [selectedServiceId, setSelectedServiceId] = useState(
    appointment?.serviceId ?? activeServices[0]?.id ?? '',
  )
  const [selectedMemberOperationId, setSelectedMemberOperationId] =
    useState(initialMemberOperationId)
  useEffect(() => {
    if (open) {
      setSelectedDate(initialDate)
      setSelectedServiceId(appointment?.serviceId ?? activeServices[0]?.id ?? '')
      setSelectedMemberOperationId(initialMemberOperationId)
    }
  }, [open, initialDate, appointment?.serviceId, activeServices, initialMemberOperationId])

  const selectedDuration = useMemo(() => {
    const svc = activeServices.find((s) => s.id === selectedServiceId)
    return svc ? resolveCatalogItemForUnit(svc, unitId).durationMinutes : 0
  }, [activeServices, selectedServiceId, unitId])

  const { options: startTimeOptions, defaultValue: startTimeDefault } = useMemo(() => {
    if (!appointmentGrid) return { options: [] as string[], defaultValue: undefined }
    const dayHours = getBusinessHoursForDay(appointmentGrid.businessHours, selectedDate, timezone)
    const grid = gridTimeOptions(dayHours, appointmentGrid.slotMinutes, selectedDuration, {
      date: selectedDate,
      timezone,
      nowMs: Date.now(),
    })
    const available = filterGridByBusy(
      grid,
      busyByMemberOperation[selectedMemberOperationId] ?? [],
      {
        date: selectedDate,
        timezone,
        durationMinutes: selectedDuration,
        excludeAppointmentId: appointment?.id ?? null,
      },
    )
    return resolveStartTimePicker({
      grid: available,
      editMode,
      initialStartTime,
      keepInitial: selectedDate === initialDate,
    })
  }, [
    appointmentGrid,
    selectedDate,
    selectedDuration,
    selectedMemberOperationId,
    busyByMemberOperation,
    appointment?.id,
    initialStartTime,
    initialDate,
    timezone,
    editMode,
  ])

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

  const canMarkNoShow =
    editMode &&
    appointment.status === 'scheduled' &&
    new Date(appointment.startAt).getTime() <= Date.now()

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
            <Select
              name="serviceId"
              required
              value={selectedServiceId || undefined}
              onValueChange={setSelectedServiceId}
            >
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
            <Select
              name="memberOperationId"
              required
              value={selectedMemberOperationId || undefined}
              onValueChange={setSelectedMemberOperationId}
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
                    {c.name} · {formatBrazilPhone(c.mobile)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Input name="newCustomerName" placeholder="Nome" required minLength={2} />
              <PhoneInput name="newCustomerMobile" required />
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
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="appointment-startTime" className="text-sm font-medium">
                Início
              </Label>
              {appointmentGrid ? (
                <Select name="startTime" required defaultValue={startTimeDefault}>
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
              ) : (
                <Input
                  id="appointment-startTime"
                  type="time"
                  name="startTime"
                  defaultValue={initialStartTime}
                  required
                />
              )}
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
