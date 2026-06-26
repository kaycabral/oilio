'use client'

import { PhoneInput } from '@/components/PhoneInput'
import type { Customer } from '@/domain'
import { createCustomer, updateCustomer } from '@/features/customers/adapters/customers.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, Label } from '@cbrl/design'
import { useState, useTransition } from 'react'

export function CustomerForm({ customer }: { customer?: Customer }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = customer
        ? await updateCustomer(customer.id, formData)
        : await createCustomer(formData)
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
      <div className="flex flex-col gap-1">
        <Label htmlFor="customer-name" className="text-sm font-medium">
          Nome
        </Label>
        <Input
          id="customer-name"
          name="name"
          defaultValue={customer?.name ?? ''}
          required
          minLength={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="customer-whatsapp" className="text-sm font-medium">
            WhatsApp
          </Label>
          <PhoneInput
            id="customer-whatsapp"
            name="whatsapp"
            defaultValue={customer?.whatsapp ?? ''}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="customer-birthDate" className="text-sm font-medium">
            Data de nascimento
          </Label>
          <DateField
            id="customer-birthDate"
            name="birthDate"
            defaultValue={customer?.birthDate ?? ''}
            max={new Date().toISOString().slice(0, 10)}
            captionLayout="dropdown"
          />
          <span className="text-muted-foreground text-xs">Opcional.</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="customer-email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="customer-email"
          name="email"
          type="email"
          defaultValue={customer?.email ?? ''}
          placeholder="cliente@empresa.com"
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid}>
          {(() => {
            if (pending) return 'Salvando…'
            return customer ? 'Salvar' : 'Criar'
          })()}
        </Button>
      </div>
    </form>
  )
}
