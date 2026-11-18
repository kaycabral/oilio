'use client'

import { setActiveUnit } from '@/shared/org/active-unit-actions'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@oilio/design'
import { Store } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function SelectUnitForm({
  orgName,
  units,
}: {
  orgName: string
  units: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  function choose(unitId: string) {
    setChosen(unitId)
    setError(null)
    startTransition(async () => {
      const result = await setActiveUnit(unitId)
      if (!result.ok) {
        setError(result.error)
        setChosen(null)
        return
      }
      router.replace('/agenda')
    })
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Escolha a unidade</CardTitle>
        <CardDescription>
          {orgName} tem mais de uma unidade. Selecione onde você vai operar — você troca a qualquer
          momento pelo seletor no topo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {units.map((u) => (
          <Button
            key={u.id}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => choose(u.id)}
            className="justify-start gap-2"
            value={u.id}
          >
            <Store className="size-4" aria-hidden />
            <span className="truncate">{u.name}</span>
            {pending && chosen === u.id && (
              <span className="text-muted-foreground ml-auto text-xs">Entrando…</span>
            )}
          </Button>
        ))}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}
