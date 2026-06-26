'use client'

import {
  type CancellationPolicy,
  type ConfirmationTemplates,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  resolveWhatsappTemplates,
  SLOT_MINUTES_OPTIONS,
  type SlotMinutes,
} from '@/domain'
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@cbrl/design'
import { useState } from 'react'

// Appointment-only agenda configs, revealed INLINE by the unit form when the
// hours mode = "appointment" (progressive disclosure, PRD Identidade v2 / C3):
// the slot granularity, the self-service cancellation policy, and the
// confirmation/reminder/cancellation message templates. These moved Org→Unit and
// exist ONLY in the appointment agenda variant — the form never renders this
// block for fixed/always_open. Sensible defaults (the canonical WhatsApp
// templates + a 120-min notice) pre-fill the fields so they're ready but
// editable. Field names match `parseAppointmentConfig` in the functional core.
export function UnitAgendaConfigFields({
  slotMinutes,
  cancellationPolicy,
  confirmationTemplates,
}: {
  slotMinutes?: SlotMinutes
  cancellationPolicy?: CancellationPolicy
  confirmationTemplates?: ConfirmationTemplates
}) {
  const policy = cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY
  const templates = resolveWhatsappTemplates(confirmationTemplates)
  const [cancellationEnabled, setCancellationEnabled] = useState(policy.enabled)

  return (
    <FieldSet className="gap-4">
      <FieldLegend>Configurações de agenda</FieldLegend>
      <FieldDescription>Estas opções valem só para o modo por agendamento.</FieldDescription>

      <Field>
        <FieldLabel htmlFor="slotMinutes">Granularidade dos horários</FieldLabel>
        <Select name="slotMinutes" defaultValue={String(slotMinutes ?? DEFAULT_SLOT_MINUTES)}>
          <SelectTrigger id="slotMinutes" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SLOT_MINUTES_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m} minutos
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Intervalo entre os horários oferecidos ao cliente.</FieldDescription>
      </Field>

      <Field orientation="horizontal" className="items-center justify-between">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="cancellationEnabled">Cancelamento pelo cliente</FieldLabel>
          <FieldDescription>Permite que o cliente cancele pela página pública.</FieldDescription>
        </div>
        <Switch
          id="cancellationEnabled"
          name="cancellationEnabled"
          checked={cancellationEnabled}
          onCheckedChange={setCancellationEnabled}
        />
      </Field>

      {cancellationEnabled ? (
        <Field>
          <FieldLabel htmlFor="cancellationMinNotice">Antecedência mínima (minutos)</FieldLabel>
          <Input
            id="cancellationMinNotice"
            name="cancellationMinNotice"
            type="number"
            min={0}
            max={7 * 24 * 60}
            step={5}
            defaultValue={policy.minNoticeMinutes}
          />
          <FieldDescription>
            O cliente só pode cancelar com pelo menos essa antecedência.
          </FieldDescription>
        </Field>
      ) : null}

      <FieldSet className="gap-3">
        <FieldLegend className="text-sm">Mensagens automáticas</FieldLegend>
        <Field>
          <FieldLabel htmlFor="templateConfirmation">Confirmação</FieldLabel>
          <Textarea
            id="templateConfirmation"
            name="templateConfirmation"
            rows={3}
            defaultValue={templates.confirmation}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="templateReminder">Lembrete</FieldLabel>
          <Textarea
            id="templateReminder"
            name="templateReminder"
            rows={3}
            defaultValue={templates.reminder}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="templateCancellation">Cancelamento</FieldLabel>
          <Textarea
            id="templateCancellation"
            name="templateCancellation"
            rows={3}
            defaultValue={templates.cancellation}
          />
        </Field>
      </FieldSet>
    </FieldSet>
  )
}
