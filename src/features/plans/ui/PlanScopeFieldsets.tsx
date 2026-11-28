'use client'

import { type AllowedTimeScope, type BookingLimits, WEEKDAYS } from '@/domain'
import { WEEKDAY_LABELS } from '@/features/plans/core/plan-form-defaults'
import { Checkbox, Input, Label } from '@cbrl/design'
import { useId } from 'react'

export function PlanTimeScopeFieldset({
  restrictDays,
  setRestrictDays,
  restrictHours,
  setRestrictHours,
  restrictAdvance,
  setRestrictAdvance,
  initialDays,
  initialScope,
}: {
  restrictDays: boolean
  setRestrictDays: (v: boolean) => void
  restrictHours: boolean
  setRestrictHours: (v: boolean) => void
  restrictAdvance: boolean
  setRestrictAdvance: (v: boolean) => void
  initialDays: Set<number>
  initialScope: AllowedTimeScope | undefined
}) {
  const uid = useId()
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Horários do plano</legend>
      <p className="text-muted-foreground pb-2 text-xs">
        Restrinja quando assinantes podem agendar. Sem restrição = mesma janela do estabelecimento.
      </p>

      <div className="flex items-center gap-2 py-2 text-sm">
        <Checkbox
          id={`${uid}-plan-restrictDaysOfWeek`}
          name="restrictDaysOfWeek"
          checked={restrictDays}
          onCheckedChange={(checked) => setRestrictDays(checked === true)}
        />
        <Label htmlFor={`${uid}-plan-restrictDaysOfWeek`} className="font-normal">
          Restringir dias da semana
        </Label>
      </div>
      {restrictDays ? (
        <div className="flex flex-wrap gap-3 pt-1 pb-2">
          {WEEKDAYS.map((day, idx) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <Checkbox
                name="daysOfWeek"
                value={String(idx)}
                defaultChecked={initialDays.has(idx)}
              />
              {WEEKDAY_LABELS[day]}
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 py-2 text-sm">
        <Checkbox
          id={`${uid}-plan-restrictHourRange`}
          name="restrictHourRange"
          checked={restrictHours}
          onCheckedChange={(checked) => setRestrictHours(checked === true)}
        />
        <Label htmlFor={`${uid}-plan-restrictHourRange`} className="font-normal">
          Restringir faixa horária
        </Label>
      </div>
      {restrictHours ? (
        <div className="grid grid-cols-2 gap-3 pb-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-plan-hourRangeStart`} className="text-xs font-medium">
              Início
            </Label>
            <Input
              id={`${uid}-plan-hourRangeStart`}
              name="hourRangeStart"
              type="time"
              defaultValue={initialScope?.hourRange?.start ?? '08:00'}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-plan-hourRangeEnd`} className="text-xs font-medium">
              Fim
            </Label>
            <Input
              id={`${uid}-plan-hourRangeEnd`}
              name="hourRangeEnd"
              type="time"
              defaultValue={initialScope?.hourRange?.end ?? '18:00'}
              required
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 py-2 text-sm">
        <Checkbox
          id={`${uid}-plan-restrictAdvance`}
          name="restrictAdvance"
          checked={restrictAdvance}
          onCheckedChange={(checked) => setRestrictAdvance(checked === true)}
        />
        <Label htmlFor={`${uid}-plan-restrictAdvance`} className="font-normal">
          Restringir janela de antecedência
        </Label>
      </div>
      {restrictAdvance ? (
        <div className="flex flex-col gap-1 pb-1">
          <Label htmlFor={`${uid}-plan-advanceBookingDays`} className="text-xs font-medium">
            Dias máximos antecipados
          </Label>
          <Input
            id={`${uid}-plan-advanceBookingDays`}
            name="advanceBookingDays"
            type="number"
            min={1}
            defaultValue={
              typeof initialScope?.advanceBookingDays === 'number'
                ? String(initialScope.advanceBookingDays)
                : ''
            }
            required
          />
        </div>
      ) : null}
    </fieldset>
  )
}

export function PlanBookingLimitsFieldset({
  restrictBookingLimits,
  setRestrictBookingLimits,
  initialLimits,
}: {
  restrictBookingLimits: boolean
  setRestrictBookingLimits: (v: boolean) => void
  initialLimits: BookingLimits | undefined
}) {
  const uid = useId()
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Limites de agendamento</legend>
      <p className="text-muted-foreground pb-2 text-xs">
        Controle quantos agendamentos o assinante pode manter. Sem restrição = sem limite.
      </p>

      <div className="flex items-center gap-2 py-2 text-sm">
        <Checkbox
          id={`${uid}-plan-restrictBookingLimits`}
          name="restrictBookingLimits"
          checked={restrictBookingLimits}
          onCheckedChange={(checked) => setRestrictBookingLimits(checked === true)}
        />
        <Label htmlFor={`${uid}-plan-restrictBookingLimits`} className="font-normal">
          Restringir agendamentos do assinante
        </Label>
      </div>

      {restrictBookingLimits ? (
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-plan-maxPerDay`} className="text-xs font-medium">
              Máximo por dia
            </Label>
            <Input
              id={`${uid}-plan-maxPerDay`}
              name="maxPerDay"
              type="number"
              min={1}
              defaultValue={
                typeof initialLimits?.maxPerDay === 'number' ? String(initialLimits.maxPerDay) : '1'
              }
              placeholder="Vazio = sem limite por dia"
            />
            <span className="text-muted-foreground text-xs">
              Tentar criar acima do limite abre modal de reagendamento.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-plan-maxConcurrent`} className="text-xs font-medium">
              Máximo de futuros simultâneos
            </Label>
            <Input
              id={`${uid}-plan-maxConcurrent`}
              name="maxConcurrent"
              type="number"
              min={1}
              defaultValue={
                typeof initialLimits?.maxConcurrent === 'number'
                  ? String(initialLimits.maxConcurrent)
                  : ''
              }
              placeholder="Vazio = ilimitado"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${uid}-plan-requireCompleteBeforeNext`}
              name="requireCompleteBeforeNext"
              defaultChecked={initialLimits?.requireCompleteBeforeNext === true}
            />
            <Label htmlFor={`${uid}-plan-requireCompleteBeforeNext`} className="font-normal">
              Exigir concluir o atual antes de marcar o próximo
            </Label>
          </div>
        </div>
      ) : null}
    </fieldset>
  )
}
