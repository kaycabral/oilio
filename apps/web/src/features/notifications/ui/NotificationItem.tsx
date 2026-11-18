'use client'

import { isDispatchableType } from '@/domain'
import { formatRelativeTime } from '@/features/notifications/core/format'
import { readJson } from '@/shared/http'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oilio/design'
import {
  AlertTriangle,
  Bell,
  Cake,
  Check,
  Clock,
  CreditCard,
  MessageCircle,
  MoreHorizontal,
  ShoppingCart,
  UserPlus,
} from 'lucide-react'
import { useState } from 'react'
import type { NotificationSummary } from './notification-types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function validateDispatchResponse(data: unknown): { link: string } {
  if (!isRecord(data) || typeof data.link !== 'string') {
    throw new Error('Invalid dispatch response')
  }
  return { link: data.link }
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; label: string }> = {
  birthday: { icon: Cake, label: 'Aniversário' },
  subscription_expiring_tomorrow: { icon: Clock, label: 'Assinatura vence amanhã' },
  subscription_expired: { icon: AlertTriangle, label: 'Assinatura vencida' },
  subscription_overdue_followup: { icon: AlertTriangle, label: 'Assinatura — follow-up' },
  order_stale: { icon: ShoppingCart, label: 'Venda pendente' },
  cash_register_open: { icon: CreditCard, label: 'Caixa aberto' },
  new_customer: { icon: UserPlus, label: 'Novo cliente' },
  payment_failure: { icon: AlertTriangle, label: 'Falha no pagamento' },
}

export function NotificationItem({
  notification,
  onChanged,
}: {
  notification: NotificationSummary
  onChanged?: () => void
}) {
  const config = TYPE_CONFIG[notification.type] ?? { icon: Bell, label: notification.type }
  const Icon = config.icon
  const canDispatch = isDispatchableType(notification.type)
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<Response>) {
    setPending(true)
    try {
      const res = await action()
      if (!res.ok) return null
      return res
    } finally {
      setPending(false)
    }
  }

  async function openWhatsapp() {
    const res = await run(() =>
      fetch(`/api/notifications/${notification.id}/dispatch`, { method: 'POST' }),
    )
    if (!res) return
    const data = await readJson(res, validateDispatchResponse)
    window.open(data.link, '_blank', 'noopener,noreferrer')
    onChanged?.()
  }

  async function markRead() {
    const res = await run(() =>
      fetch(`/api/notifications/${notification.id}/read`, { method: 'POST' }),
    )
    if (res) onChanged?.()
  }

  async function snooze(option: '4h' | 'tomorrow') {
    const res = await run(() =>
      fetch(`/api/notifications/${notification.id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option }),
      }),
    )
    if (res) onChanged?.()
  }

  return (
    <li className="hover:bg-muted/50 flex items-start gap-3 px-4 py-3">
      <div className="bg-muted mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{config.label}</p>
        <p className="text-muted-foreground truncate text-xs">
          {notification.createdAt ? formatRelativeTime(notification.createdAt) : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canDispatch && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void openWhatsapp()}
            disabled={pending}
            title="Abrir WhatsApp"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="sr-only">Abrir WhatsApp</span>
          </Button>
        )}
        {!canDispatch && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void markRead()}
            disabled={pending}
            title="Marcar como lida"
          >
            <Check className="h-4 w-4" />
            <span className="sr-only">Marcar como lida</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={pending} title="Adiar">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Adiar</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void snooze('4h')}>Adiar 4h</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void snooze('tomorrow')}>
              Adiar pra amanhã
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
