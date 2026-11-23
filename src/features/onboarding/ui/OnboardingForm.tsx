'use client'

import { VERTICALS, type Vertical } from '@/domain'
import { createOrg } from '@/features/onboarding/adapters/onboarding.actions'
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
  Typography,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

const VERTICAL_LABELS: Record<Vertical, string> = {
  barbershop: 'Barbearia',
  auto_wash: 'Lavagem automotiva',
  auto_detailing: 'Estética automotiva',
  other: 'Outro',
}

export function OnboardingForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createOrg(formData)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace('/')
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex w-full flex-col gap-4"
    >
      <header className="mb-2 space-y-1">
        <Typography variant="pageTitle">Dê um nome ao seu negócio</Typography>
        <p className="text-muted-foreground text-sm">Você pode mudar depois.</p>
      </header>

      <div className="flex flex-col gap-1">
        <Label htmlFor="onboarding-name" className="text-sm font-medium">
          Nome do negócio
        </Label>
        <Input
          id="onboarding-name"
          name="name"
          required
          minLength={2}
          placeholder="Barbearia do Bairro"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="onboarding-vertical" className="text-sm font-medium">
          Segmento
        </Label>
        <Select name="vertical" required>
          <SelectTrigger id="onboarding-vertical">
            <SelectValue placeholder="Escolha o segmento" />
          </SelectTrigger>
          <SelectContent>
            {VERTICALS.map((v) => (
              <SelectItem key={v} value={v}>
                {VERTICAL_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <Button type="submit" disabled={pending || !isValid}>
        {pending ? 'Criando…' : 'Criar negócio'}
      </Button>
    </form>
  )
}
