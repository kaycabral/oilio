'use client'

import type { FixedCostCategory } from '@/domain'
import { FIXED_COST_DEFAULT_CATEGORY, isFixedCostCategory } from '@/domain'
import { createFixedCost } from '@/features/finance/adapters/fixed-costs.actions'
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

export const FIXED_COST_CATEGORY_LABELS: Record<FixedCostCategory, string> = {
  expense_admin: 'Administrativa',
  expense_commercial: 'Comercial',
  expense_financial: 'Financeira',
}

type FixedCostFormProps = {
  unitId: string
}

export function FixedCostForm({ unitId }: FixedCostFormProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const nameId = useId()
  const amountId = useId()
  const categoryId = useId()
  const [category, setCategory] = useState<FixedCostCategory>(FIXED_COST_DEFAULT_CATEGORY)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createFixedCost(formData)
      if (res.ok) {
        formRef.current?.reset()
        setCategory(FIXED_COST_DEFAULT_CATEGORY)
      } else {
        setError(res.error)
      }
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
      <input type="hidden" name="category" value={category} />

      <div className="flex flex-col gap-1">
        <Label htmlFor={nameId} className="text-sm font-medium">
          Nome
        </Label>
        <Input
          id={nameId}
          name="name"
          placeholder="Aluguel"
          minLength={2}
          maxLength={60}
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={amountId} className="text-sm font-medium">
          Valor mensal (R$)
        </Label>
        <Input
          id={amountId}
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          placeholder="0,00"
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={categoryId} className="text-sm font-medium">
          Categoria
        </Label>
        <Select
          value={category}
          onValueChange={(v) => {
            if (isFixedCostCategory(v)) setCategory(v)
          }}
        >
          <SelectTrigger id={categoryId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FIXED_COST_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? 'Salvando…' : 'Adicionar custo fixo'}
        </Button>
      </div>
    </form>
  )
}
