'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { formatBrazilPhone, type Customer } from '@/domain'
import { assignCustomerToOrder } from '@/features/orders/adapters/orders.actions'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

type Mode = 'existing' | 'new'

// Customer selector for a walk-in order (brief 0081 / #1323). Renders in the
// header while the order is editable, to link / swap / unlink the customer via a
// `<form action>` server action (the repo's mandatory mutation pattern). Mirrors
// the AppointmentDialog picker: pick an existing customer OR register a new one
// inline (gated on `canRegisterCustomer`). On success the server re-evaluates
// coverage, so a linked subscriber's covered items auto-mark on the refresh.
export function OrderCustomerSelector({
  orderId,
  customer,
  customers,
  canRegisterCustomer,
}: {
  orderId: string
  customer: Customer | null
  customers: Customer[]
  canRegisterCustomer: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('existing')

  // Client handler wrapping the server action (repo pattern — see OrderAddItemForm):
  // the action returns a result, so a thin `onSubmit` runs it in a transition and
  // surfaces the error via toast, keeping `<form action>` progressive-enhancement.
  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await assignCustomerToOrder(orderId, formData)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {customer ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{customer.name}</span>
          <form action={onSubmit}>
            <input type="hidden" name="customerMode" value="none" />
            <button
              type="submit"
              disabled={pending}
              className="text-muted-foreground text-xs hover:underline"
            >
              remover
            </button>
          </form>
        </div>
      ) : null}

      <form action={onSubmit} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="customerMode" value={mode} />
        {mode === 'existing' ? (
          <Select name="customerId" required>
            <SelectTrigger id="order-customer" className="w-56">
              <SelectValue placeholder={customer ? 'Trocar cliente…' : 'Vincular cliente…'} />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {formatBrazilPhone(c.whatsapp)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Input name="newCustomerName" placeholder="Nome" required minLength={2} />
            <PhoneInput name="newCustomerWhatsapp" required />
          </div>
        )}
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {customer ? 'Trocar' : 'Vincular'}
        </Button>
        {canRegisterCustomer ? (
          <button
            type="button"
            onClick={() => setMode(mode === 'existing' ? 'new' : 'existing')}
            className="text-primary text-xs hover:underline"
          >
            {mode === 'existing' ? '+ Cadastrar novo' : '← Usar existente'}
          </button>
        ) : null}
      </form>
    </div>
  )
}
