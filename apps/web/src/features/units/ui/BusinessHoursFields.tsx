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
} from '@cbrl/design'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Segunda',
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

// Display order — start the week on Sunday (Brazilian calendar convention).
const ORDERED_WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

// SPIKE (hours mode): the three WhatsApp-Business-style modes. Only the
// appointment mode carries a hint — it's the one with a non-obvious side effect
// (turns the unit's online agenda on); the other two labels are self-evident.
const MODE_OPTIONS: { value: UnitHoursMode; label: string; hint?: string }[] = [
  { value: 'fixed', label: 'Aberto em horários definidos' },
  { value: 'always_open', label: 'Sempre aberto · 24h' },
  {
    value: 'appointment',
    label: 'Por agendamento',
    // Kept to one line at the form width so the reserved hint row (min-h-5)
    // matches exactly — no flick, no big empty gap when other modes are picked.
    hint: 'Ativa o agendamento online nos horários abaixo.',
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
  // Controlled by the parent UnitForm so it can reveal the appointment-only
  // agenda configs below the hours when `appointment` is chosen (progressive
  // disclosure, PRD Identidade v2 / C3).
  mode: UnitHoursMode
  onModeChange: (mode: UnitHoursMode) => void
}) {
  const [state, setState] = useState<Record<Weekday, DayState>>(() => initialState(defaults))

  const activeHint = MODE_OPTIONS.find((m) => m.value === mode)?.hint ?? ''

  // Enabling a day seeds a default interval when it has none; disabling keeps
  // the configured intervals so re-enabling restores them.
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
  // Removing the last interval closes the day (the switch follows).
  function removeRange(day: Weekday, i: number) {
    setState((prev) => {
      const ranges = prev[day].ranges.filter((_, idx) => idx !== i)
      return { ...prev, [day]: { enabled: ranges.length > 0, ranges } }
    })
  }

  // SPIKE (multi-interval): a day can have split shifts (e.g. 09:00–12:00 and
  // 14:00–18:00 with a lunch gap). Each enabled day in fixed/appointment mode
  // shows its ranges with add/remove; 24h mode is a flat "Aberto 24 horas";
  // a day that's off (any mode) reads "Fechado".
  function renderRanges(day: Weekday, st: DayState) {
    // Every "first row" is h-9 so single-interval / "Fechado" / "24h" share the
    // same height (no flick on delete or mode switch). Extra intervals stack
    // BELOW (items-start), growing the row downward.
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
              {/* One "+" per day, on the last row, so there's no extra add-row
                  (keeps the height stable). Rendered invisible on other rows to
                  keep the trash column aligned. */}
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
      <FieldLegend>Horário de funcionamento</FieldLegend>

      <Field className="pb-1">
        <FieldLabel htmlFor="hoursMode">Modo</FieldLabel>
        <Select
          name="hoursMode"
          value={mode}
          onValueChange={(v) => {
            if (isUnitHoursMode(v)) onModeChange(v)
          }}
        >
          <SelectTrigger id="hoursMode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* min-h-5 reserves one line so empty (other modes) matches the
            appointment hint height — no flick. Font size is the FieldDescription
            default (text-xs). */}
        <FieldDescription className="min-h-5">{activeHint}</FieldDescription>
      </Field>

      {/* Divider between days so a multi-interval day doesn't visually merge
          into the next day's first interval. */}
      <div className="divide-border/60 flex flex-col divide-y pt-1">
        {ORDERED_WEEKDAYS.map((day) => {
          const st = state[day]
          const id = `bh_${day}`
          return (
            <Field key={day} orientation="horizontal" className="items-start py-2.5">
              {/* h-9 cell keeps the switch + weekday centered on the first
                  interval row without manual offsets. */}
              <div className="flex h-9 flex-none items-center gap-2">
                <Switch
                  id={id}
                  name={`${id}_enabled`}
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
    </FieldSet>
  )
}
