'use client'

import { Button } from '@oilio/design'
import { useFormStatus } from 'react-dom'

export function NewSaleButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Abrindo…' : 'Nova venda'}
    </Button>
  )
}
