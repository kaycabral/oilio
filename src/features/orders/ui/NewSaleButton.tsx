'use client'

import { Button } from '@cbrl/design'
import { useFormStatus } from 'react-dom'

export function NewSaleButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Abrindo…' : 'Nova venda'}
    </Button>
  )
}
