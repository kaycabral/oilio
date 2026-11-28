'use client'

import {
  AGENDA_BLOCK_KINDS,
  type AgendaBlock,
  type AgendaBlockKind,
  type StoredUnit,
  type Weekday,
} from '@/domain'
import { createBlock, updateBlock } from '@/features/agenda/adapters/blocks.actions'
import { oneOffToLocal } from '@/features/agenda/core/block-time'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useId, useState, useTransition } from 'react'

const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 'monday', label: 'Segunda' },
  { value: 'tuesday', label: 'Terça' },
  { value: 'wednesday', label: 'Quarta' },
  { value: 'thursday', label: 'Quinta' },
  { value: 'friday', label: 'Sexta' },
  { value: 'saturday', label: 'Sábado' },
  { value: 'sunday', label: 'Domingo' },
]

export type BlockOwner =
  | { scope: 'unit'; unitId: string }
  | { scope: 'member_operator'; memberOperationId: string; units: StoredUnit[] }

function isAgendaBlockKind(v: string): v is AgendaBlockKind {
  return (AGENDA_BLOCK_KINDS as readonly string[]).includes(v)
}

export function BlockForm({
  owner,
  block,
  orgTimezone,
  onDone,
}: {
  owner: BlockOwner
  block?: AgendaBlock
  orgTimezone: string
  onDone?: () => void
}) {
  const uid = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<AgendaBlockKind>(block?.kind ?? 'recurring')
  const { formRef, isValid, refresh } = useFormValidity()
  const ids = useId()
  const reasonId = `${ids}-reason`
  const openId = `${ids}-open`
  const closeId = `${ids}-close`
  const dateId = `${ids}-date`
  const startId = `${ids}-start`
  const endId = `${ids}-end`

  const oneOffDefaults =
    block && block.kind === 'one_off'
      ? oneOffToLocal(block.startAt, block.endAt, orgTimezone)
      : { date: '', start: '09:00', end: '10:00' }

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = block ? await updateBlock(block.id, formData) : await createBlock(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      onDone?.()
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-4"
    >
      {owner.scope === 'unit' ? (
        <>
          <input type="hidden" name="unitId" value={owner.unitId} />
          <input type="hidden" name="memberOperationId" value="" />
        </>
      ) : (
        <>
          <input type="hidden" name="memberOperationId" value={owner.memberOperationId} />
          {owner.units.length > 1 ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${uid}-block-unit`} className="text-sm font-medium">
                Unidade
              </Label>
              <Select
                name="unitId"
                defaultValue={block?.unitId ?? owner.units[0]?.id ?? ''}
                required
              >
                <SelectTrigger id={`${uid}-block-unit`}>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {owner.units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <input type="hidden" name="unitId" value={block?.unitId ?? owner.units[0]?.id ?? ''} />
          )}
        </>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-block-kind`} className="text-sm font-medium">
          Tipo
        </Label>
        <Select
          name="kind"
          value={kind}
          onValueChange={(value) => {
            if (isAgendaBlockKind(value)) setKind(value)
          }}
          required
        >
          <SelectTrigger id={`${uid}-block-kind`}>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recurring">Recorrente (dia da semana)</SelectItem>
            <SelectItem value="one_off">Pontual (data específica)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={reasonId} className="text-sm font-medium">
          Motivo
        </Label>
        <Input
          id={reasonId}
          name="reason"
          defaultValue={block?.reason ?? ''}
          required
          minLength={2}
          maxLength={60}
          placeholder="Almoço, Médico, Viagem…"
        />
      </div>

      {kind === 'recurring' ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-block-weekday`} className="text-sm font-medium">
              Dia da semana
            </Label>
            <Select
              name="weekday"
              defaultValue={block?.kind === 'recurring' ? block.weekday : 'monday'}
              required
            >
              <SelectTrigger id={`${uid}-block-weekday`}>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={openId} className="text-sm font-medium">
              Início
            </Label>
            <Input
              id={openId}
              type="time"
              name="open"
              defaultValue={block?.kind === 'recurring' ? block.open : '12:00'}
              required
              step={300}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={closeId} className="text-sm font-medium">
              Fim
            </Label>
            <Input
              id={closeId}
              type="time"
              name="close"
              defaultValue={block?.kind === 'recurring' ? block.close : '13:00'}
              required
              step={300}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={dateId} className="text-sm font-medium">
              Data
            </Label>
            <Input
              id={dateId}
              type="date"
              name="date"
              defaultValue={oneOffDefaults.date}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={startId} className="text-sm font-medium">
              Início
            </Label>
            <Input
              id={startId}
              type="time"
              name="start"
              defaultValue={oneOffDefaults.start}
              required
              step={300}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={endId} className="text-sm font-medium">
              Fim
            </Label>
            <Input
              id={endId}
              type="time"
              name="end"
              defaultValue={oneOffDefaults.end}
              required
              step={300}
            />
          </div>
        </div>
      )}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-2">
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || !isValid}>
          {(() => {
            if (pending) return 'Salvando…'
            return block ? 'Salvar' : 'Criar'
          })()}
        </Button>
      </div>
    </form>
  )
}
