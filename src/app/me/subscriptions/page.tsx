import { loadMySubscriptionsPage } from '@/features/me/adapters/load-me'
import { SubscriptionRow } from '@/features/me/ui/SubscriptionRow'
import { Main } from '@cbrl/design'
import type { Metadata } from 'next'
import { connection } from 'next/server'

export const instant = false

export const metadata: Metadata = { title: 'Minhas assinaturas' }

export default async function MySubscriptionsPage() {
  await connection()
  const data = await loadMySubscriptionsPage()

  if (data.empty) {
    return (
      <Main width="narrow" className="space-y-4">
        <h1 className="text-2xl font-semibold">Minhas assinaturas</h1>
        <p className="text-muted-foreground">
          Você ainda não possui assinaturas. Entre em contato com seu estabelecimento.
        </p>
      </Main>
    )
  }

  return (
    <Main width="narrow" className="space-y-4">
      <h1 className="text-2xl font-semibold">Minhas assinaturas</h1>
      <ul className="space-y-3">
        {data.rows.map((row) => (
          <li key={row.subscription.id}>
            <SubscriptionRow data={row} />
          </li>
        ))}
      </ul>
    </Main>
  )
}
