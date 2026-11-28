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
import { useId, useState } from 'react'

export function UnitAgendaConfigFields({
  slotMinutes,
  cancellationPolicy,
  confirmationTemplates,
}: {
  slotMinutes?: SlotMinutes
  cancellationPolicy?: CancellationPolicy
  confirmationTemplates?: ConfirmationTemplates
}) {
  const uid = useId()
  const policy = cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY
  const templates = resolveWhatsappTemplates(confirmationTemplates)
  const [cancellationEnabled, setCancellationEnabled] = useState(policy.enabled)

  return (
    <FieldSet className="gap-4">
      <FieldLegend>Configurações de agenda</FieldLegend>
      <FieldDescription>Estas opções valem só para o modo por agendamento.</FieldDescription>

      <Field>
        <FieldLabel htmlFor={`${uid}-slotMinutes`}>Granularidade dos horários</FieldLabel>
        <Select name="slotMinutes" defaultValue={String(slotMinutes ?? DEFAULT_SLOT_MINUTES)}>
          <SelectTrigger id={`${uid}-slotMinutes`} className="w-full">
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
          <FieldLabel htmlFor={`${uid}-cancellationEnabled`}>Cancelamento pelo cliente</FieldLabel>
          <FieldDescription>Permite que o cliente cancele pela página pública.</FieldDescription>
        </div>
        <Switch
          id={`${uid}-cancellationEnabled`}
          name="cancellationEnabled"
          checked={cancellationEnabled}
          onCheckedChange={setCancellationEnabled}
        />
      </Field>

      {cancellationEnabled ? (
        <Field>
          <FieldLabel htmlFor={`${uid}-cancellationMinNotice`}>
            Antecedência mínima (minutos)
          </FieldLabel>
          <Input
            id={`${uid}-cancellationMinNotice`}
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
          <FieldLabel htmlFor={`${uid}-templateConfirmation`}>Confirmação</FieldLabel>
          <Textarea
            id={`${uid}-templateConfirmation`}
            name="templateConfirmation"
            rows={3}
            defaultValue={templates.confirmation}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-templateReminder`}>Lembrete</FieldLabel>
          <Textarea
            id={`${uid}-templateReminder`}
            name="templateReminder"
            rows={3}
            defaultValue={templates.reminder}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-templateCancellation`}>Cancelamento</FieldLabel>
          <Textarea
            id={`${uid}-templateCancellation`}
            name="templateCancellation"
            rows={3}
            defaultValue={templates.cancellation}
          />
        </Field>
      </FieldSet>
    </FieldSet>
  )
}
