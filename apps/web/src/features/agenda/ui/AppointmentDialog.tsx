'use client'

import { PhoneInput } from '@/components/PhoneInput'
import {
  formatBrazilPhone,
  type Appointment,
  type CatalogServiceItem,
  type Customer,
  type Professional,
} from '@/domain'
import { createAppointment, updateAppointment } from '@/features/agenda/adapters/agenda.actions'
import {
  buildAppointmentWhatsappLink,
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
  professionals,
  services,
  customers,
  date,
  timezone,
  defaultProfessionalId,
  defaultStartTime,
  appointment,
  businessName,
  confirmationTemplate,
  selfProfessionalId = null,
  canRegisterCustomer = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unitId: string
  professionals: Professional[]
  services: CatalogServiceItem[]
  customers: Customer[]
  date: string
  timezone: string
  defaultProfessionalId?: string
  defaultStartTime?: string
  // When provided, dialog is in edit mode; submit calls updateAppointment.
  appointment?: Appointment | null
  businessName: string
  confirmationTemplate: string
  // #1257: a self-scoped professional books only for themselves — the picker is
  // replaced by a fixed hidden input carrying this id. Null = balcão (full picker).
  selfProfessionalId?: string | null
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

  const whatsappLink = useMemo(
    () =>
      buildAppointmentWhatsappLink({
        appointment,
        customers,
        services,
        professionals,
        timezone,
        confirmationTemplate,
        businessName,
      }),
    [appointment, customers, services, professionals, timezone, confirmationTemplate, businessName],
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
            <Label htmlFor="appointment-professional" className="text-sm font-medium">
              Profissional
            </Label>
            {/* #1257: a self-scoped professional books only for themselves — the
                picker offers ONLY their own option (pre-selected), so the submit
                always carries their id. The server action + RLS also enforce it.
                The balcão gets the full list. Uses the design Select either way
                (no hand-rolled primitive). */}
            <Select
              name="professionalId"
              required
              defaultValue={
                selfProfessionalId ??
                appointment?.professionalId ??
                defaultProfessionalId ??
                undefined
              }
            >
              <SelectTrigger id="appointment-professional">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(selfProfessionalId
                  ? professionals.filter((p) => p.id === selfProfessionalId)
                  : professionals
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
              <Input
                id="appointment-startTime"
                type="time"
                name="startTime"
                defaultValue={initialStartTime}
                required
              />
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
