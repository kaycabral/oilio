'use client'

import { Button } from '@cbrl/design'
import { useFormStatus } from 'react-dom'

// Submit button for the "Nova venda" form (brief 0030, AC-01). Redirect-on-
// success server actions can't be wrapped in `useActionState` (the NEXT_REDIRECT
// marker crosses the state boundary), so pending UI comes from `useFormStatus`
// inside the submitted `<form>` — the canonical Next 16 pattern.
export function NewSaleButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Abrindo…' : 'Nova venda'}
    </Button>
  )
}
