'use client'

import type { Goal } from '@/domain'
import { defineGoal, updateGoal } from '@/features/copilot/adapters/copilot.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, Input, Label } from '@cbrl/design'
import { useId, useState, useTransition } from 'react'

type GoalFormProps = {
  unitId: string
  period: string
  goal?: Goal
}

export function GoalForm({ unitId, period, goal }: GoalFormProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const targetId = useId()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = goal ? await updateGoal(goal.id, formData) : await defineGoal(formData)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="period" value={period} />

      <div className="flex flex-col gap-1">
        <Label htmlFor={targetId} className="text-sm font-medium">
          Meta de lucro do mês (R$)
        </Label>
        <Input
          id={targetId}
          name="target"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          defaultValue={goal ? (goal.targetCents / 100).toFixed(2) : ''}
          placeholder="0,00"
          required
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid}>
          {(() => {
            if (pending) return 'Salvando…'
            return goal ? 'Salvar meta' : 'Definir meta'
          })()}
        </Button>
      </div>
    </form>
  )
}
