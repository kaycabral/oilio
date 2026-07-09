'use client'

import { RowActions, type RowAction } from '@/components/RowActions'
import type { FixedCost } from '@/domain'
import {
  archiveFixedCost,
  updateFixedCostValue,
} from '@/features/finance/adapters/fixed-costs.actions'
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
} from '@cbrl/design'
import { useEffect, useId, useState, useTransition } from 'react'

type FixedCostRowActionsProps = {
  cost: FixedCost
}

export function FixedCostRowActions({ cost }: FixedCostRowActionsProps) {
  const [editOpen, setEditOpen] = useState(false)

  const actions: RowAction[] = [
    { kind: 'button', label: 'Editar valor', onClick: () => setEditOpen(true) },
    {
      kind: 'delete',
      label: 'Arquivar',
      confirmLabel: 'Arquivar',
      action: () => archiveFixedCost(cost.id),
      title: `Arquivar ${cost.name}?`,
      description:
        'Para de gerar lançamentos a partir deste mês e some da lista de custos ativos. O histórico é preservado.',
    },
  ]

  return (
    <>
      <RowActions actions={actions} label={`Ações de ${cost.name}`} />
      <EditValueDialog cost={cost} open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}

function EditValueDialog({
  cost,
  open,
  onOpenChange,
}: FixedCostRowActionsProps & {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const amountId = useId()
  const effectiveFromId = useId()

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateFixedCostValue(cost.id, formData)
      if (res.ok) {
        onOpenChange(false)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar valor de {cost.name}</DialogTitle>
          <DialogDescription>
            O novo valor vale a partir do mês informado; os meses anteriores ficam intactos.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          action={onSubmit}
          onInput={refresh}
          onChange={refresh}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={amountId} className="text-sm font-medium">
              Novo valor mensal (R$)
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
            <Label htmlFor={effectiveFromId} className="text-sm font-medium">
              A partir do mês
            </Label>
            <Input id={effectiveFromId} name="effectiveFrom" type="month" required />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || !isValid}>
              {pending ? 'Salvando…' : 'Salvar novo valor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
