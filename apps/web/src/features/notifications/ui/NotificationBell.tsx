'use client'

import { readJson } from '@/shared/http'
import { useOrg } from '@/shared/org/org-context'
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@cbrl/design'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { NotificationItem } from './NotificationItem'
import { isNotificationSummary, type NotificationSummary } from './notification-types'

export type { NotificationSummary } from './notification-types'

type NotificationListResponse = { items: NotificationSummary[]; unreadCount: number }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function validateNotificationList(data: unknown): NotificationListResponse {
  if (!isRecord(data)) {
    throw new Error('Invalid notifications response')
  }
  const { items, unreadCount } = data
  if (!Array.isArray(items) || !items.every(isNotificationSummary)) {
    throw new Error('Invalid notifications response: items')
  }
  if (typeof unreadCount !== 'number') {
    throw new Error('Invalid notifications response: unreadCount')
  }
  return { items, unreadCount }
}

export function NotificationBell() {
  const { activeUnitId } = useOrg()
  const [notifications, setNotifications] = useState<NotificationSummary[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)

  const fetchNotifications = useCallback(async () => {
    if (!activeUnitId) return
    try {
      const res = await fetch(`/api/notifications?unitId=${activeUnitId}&limit=10`)
      if (!res.ok) return
      const data = await readJson(res, validateNotificationList)
      setNotifications(data.items)
      setUnreadCount(data.unreadCount)
    } catch {
      return
    }
  }, [activeUnitId])

  useEffect(() => {
    void fetchNotifications()
    const interval = setInterval(() => void fetchNotifications(), 30_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  useEffect(() => {
    if (open) void fetchNotifications()
  }, [open, fetchNotifications])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative ml-auto">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px]"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notificações</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="border-b px-4 py-3">
          <h4 className="text-sm font-semibold">Notificações</h4>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              Nenhuma notificação pendente
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onChanged={() => void fetchNotifications()}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-4 py-2">
          <Link
            href="/notifications"
            className="text-primary text-xs font-medium hover:underline"
            onClick={() => setOpen(false)}
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
