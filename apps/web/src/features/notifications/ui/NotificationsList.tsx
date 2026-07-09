'use client'

import type { NotificationView } from '@/features/notifications/core/notification-list'
import { Badge, Button } from '@cbrl/design'
import { AlertTriangle, Bell, Cake, Clock, CreditCard, ShoppingCart, UserPlus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

type Props = {
  notifications: NotificationView[]
  activeType: string
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; label: string }> = {
  birthday: { icon: Cake, label: 'Aniversário' },
  subscription_expiring_tomorrow: { icon: Clock, label: 'Vence amanhã' },
  subscription_expired: { icon: AlertTriangle, label: 'Vencida' },
  subscription_overdue_followup: { icon: AlertTriangle, label: 'Follow-up' },
  order_stale: { icon: ShoppingCart, label: 'Venda pendente' },
  cash_register_open: { icon: CreditCard, label: 'Caixa aberto' },
  new_customer: { icon: UserPlus, label: 'Novo cliente' },
  payment_failure: { icon: AlertTriangle, label: 'Falha pagamento' },
}

const ALL_TYPES = Object.keys(TYPE_CONFIG)

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function NotificationsList({ notifications, activeType }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`/notifications?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant={activeType === '' ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateFilter('type', '')}
        >
          Todas
        </Button>
        {ALL_TYPES.map((t) => {
          const cfg = TYPE_CONFIG[t]!
          return (
            <Button
              key={t}
              variant={activeType === t ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateFilter('type', t)}
            >
              {cfg.label}
            </Button>
          )
        })}
      </div>

      {notifications.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          Nenhuma notificação encontrada
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {notifications.map((n) => {
            const config = TYPE_CONFIG[n.type] ?? { icon: Bell, label: n.type }
            const Icon = config.icon
            const isRead = n.readAt !== null || n.dispatchedAt !== null
            return (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3 ${isRead ? 'opacity-60' : ''}`}
              >
                <div className="bg-muted mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{config.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {n.source}
                    </Badge>
                    {!isRead && (
                      <Badge variant="default" className="text-[10px]">
                        nova
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">{formatDate(n.createdAt)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
