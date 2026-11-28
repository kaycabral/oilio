'use client'

import {
  type BusinessHours,
  dayHoursToRanges,
  UNIT_HOURS_MODES,
  type UnitHoursMode,
  type Weekday,
} from '@/domain'
import {
  Button,
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  RadioGroup,
  RadioGroupItem,
  Switch,
} from '@cbrl/design'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Segunda',
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

const ORDERED_WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const MODE_OPTIONS: { value: UnitHoursMode; label: string; consequence: string }[] = [
  {
    value: 'appointment',
    label: 'Por agendamento',
    consequence: 'Clientes marcam horário. A Agenda aparece no seu menu.',
  },
  {
    value: 'fixed',
    label: 'Ordem de chegada / balcão',
    consequence: 'Sem horário marcado — você define quando a unidade abre.',
  },
  {
    value: 'always_open',
    label: 'Sempre aberto · 24h',
    consequence: 'Funciona o tempo todo, sem grade de horários.',
  },
]

type Range = { open: string; close: string }
type DayState = { enabled: boolean; ranges: Range[] }

const DEFAULT_RANGE: Range = { open: '09:00', close: '18:00' }

function isUnitHoursMode(value: string): value is UnitHoursMode {
  return (UNIT_HOURS_MODES as readonly string[]).includes(value)
}

function dayInitialState(bh: BusinessHours | null, day: Weekday): DayState {
  const ranges = dayHoursToRanges(bh?.[day] ?? null)
  return ranges.length > 0
    ? { enabled: true, ranges: ranges.map((r) => ({ open: r.open, close: r.close })) }
    : { enabled: false, ranges: [{ open: '09:00', close: '18:00' }] }
}

function initialState(bh: BusinessHours | null): Record<Weekday, DayState> {
  return {
    monday: dayInitialState(bh, 'monday'),
    tuesday: dayInitialState(bh, 'tuesday'),
    wednesday: dayInitialState(bh, 'wednesday'),
    thursday: dayInitialState(bh, 'thursday'),
    friday: dayInitialState(bh, 'friday'),
    saturday: dayInitialState(bh, 'saturday'),
    sunday: dayInitialState(bh, 'sunday'),
  }
}

export function BusinessHoursFields({
  defaults,
  mode,
  onModeChange,
}: {
  defaults: BusinessHours | null
  mode: UnitHoursMode | null
  onModeChange: (mode: UnitHoursMode) => void
}) {
  const idPrefix = useId()
  const [state, setState] = useState<Record<Weekday, DayState>>(() => initialState(defaults))

  function toggleDay(day: Weekday, enabled: boolean) {
    setState((prev) => {
      const cur = prev[day]
      const ranges = enabled && cur.ranges.length === 0 ? [{ ...DEFAULT_RANGE }] : cur.ranges
      return { ...prev, [day]: { enabled, ranges } }
    })
  }
  function setRange(day: Weekday, i: number, field: keyof Range, value: string) {
    setState((prev) => {
      const ranges = prev[day].ranges.map((r, idx) => (idx === i ? { ...r, [field]: value } : r))
      return { ...prev, [day]: { ...prev[day], ranges } }
    })
  }
  function addRange(day: Weekday) {
    setState((prev) => {
      const last = prev[day].ranges.at(-1)
      const ranges = [...prev[day].ranges, { open: last?.close ?? '13:00', close: '18:00' }]
      return { ...prev, [day]: { ...prev[day], ranges } }
    })
  }
  function removeRange(day: Weekday, i: number) {
    setState((prev) => {
      const ranges = prev[day].ranges.filter((_, idx) => idx !== i)
      return { ...prev, [day]: { enabled: ranges.length > 0, ranges } }
    })
  }

  function renderRanges(day: Weekday, st: DayState) {
    if (!st.enabled) {
      return <div className="text-muted-foreground flex h-9 items-center text-xs">Fechado</div>
    }
    if (mode === 'always_open') {
      return (
        <div className="text-muted-foreground flex h-9 items-center text-xs">Aberto 24 horas</div>
      )
    }
    return (
      <div className="flex flex-col items-end gap-1.5">
        {st.ranges.map((r, i) => {
          const isLast = i === st.ranges.length - 1
          return (
            <div key={i} className="flex h-9 items-center gap-2">
              <Input
                type="time"
                name={`bh_${day}_${i}_open`}
                value={r.open}
                onChange={(e) => setRange(day, i, 'open', e.target.value)}
                className="w-28"
                step={300}
              />
              <span className="text-muted-foreground text-xs">até</span>
              <Input
                type="time"
                name={`bh_${day}_${i}_close`}
                value={r.close}
                onChange={(e) => setRange(day, i, 'close', e.target.value)}
                className="w-28"
                step={300}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover intervalo"
                onClick={() => removeRange(day, i)}
              >
                <Trash2 />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Adicionar intervalo"
                className={isLast ? undefined : 'invisible'}
                tabIndex={isLast ? undefined : -1}
                aria-hidden={!isLast}
                onClick={() => addRange(day)}
              >
                <Plus />
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <FieldSet className="gap-3">
      <FieldLegend>Como esta unidade atende?</FieldLegend>

      <RadioGroup
        name="hoursMode"
        value={mode ?? ''}
        onValueChange={(v) => {
          if (isUnitHoursMode(v)) onModeChange(v)
        }}
        aria-label="Como esta unidade atende?"
        required
      >
        {MODE_OPTIONS.map((m) => (
          <FieldLabel
            key={m.value}
            htmlFor={`${idPrefix}-hoursMode-${m.value}`}
            className="hover:bg-accent/50 has-data-checked:border-primary has-data-checked:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <RadioGroupItem
              id={`${idPrefix}-hoursMode-${m.value}`}
              value={m.value}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-muted-foreground text-xs">{m.consequence}</span>
            </span>
          </FieldLabel>
        ))}
      </RadioGroup>

      {mode !== null && mode !== 'always_open' ? (
        <div className="divide-border/60 flex flex-col divide-y pt-1">
          {ORDERED_WEEKDAYS.map((day) => {
            const st = state[day]
            const id = `${idPrefix}-${day}`
            return (
              <Field key={day} orientation="horizontal" className="items-start py-2.5">
                <div className="flex h-9 flex-none items-center gap-2">
                  <Switch
                    id={id}
                    name={`bh_${day}_enabled`}
                    checked={st.enabled}
                    onCheckedChange={(v) => toggleDay(day, v)}
                  />
                  <FieldLabel htmlFor={id} className="w-[90px]">
                    {WEEKDAY_LABELS[day]}
                  </FieldLabel>
                </div>
                <div className="flex flex-1 justify-end">{renderRanges(day, st)}</div>
              </Field>
            )
          })}
        </div>
      ) : null}
    </FieldSet>
  )
}
