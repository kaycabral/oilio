'use client'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@cbrl/design'
import { MoreHorizontal } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { ConfirmDeleteDialog, type ConfirmDeleteProps } from './destructive/DeleteAction'

export type RowAction =
  | { kind: 'link'; label: string; href: Route; icon?: ReactNode }
  | {
      kind: 'button'
      label: string
      onClick: () => void
      icon?: ReactNode
      destructive?: boolean
    }
  | ({
      kind: 'delete'
      label?: string
      icon?: ReactNode
      disabled?: boolean
      disabledReason?: string
    } & ConfirmDeleteProps)

export function RowActions({ actions, label = 'Ações' }: { actions: RowAction[]; label?: string }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const del = actions.find((a): a is Extract<RowAction, { kind: 'delete' }> => a.kind === 'delete')

  if (actions.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((a, i) => {
            if (a.kind === 'link') {
              return (
                <DropdownMenuItem key={i} asChild>
                  <Link href={a.href}>
                    {a.icon}
                    {a.label}
                  </Link>
                </DropdownMenuItem>
              )
            }
            if (a.kind === 'button') {
              return (
                <DropdownMenuItem
                  key={i}
                  onClick={a.onClick}
                  variant={a.destructive ? 'destructive' : 'default'}
                >
                  {a.icon}
                  {a.label}
                </DropdownMenuItem>
              )
            }
            return (
              <DropdownMenuItem
                key={i}
                variant="destructive"
                disabled={a.disabled}
                title={a.disabled ? a.disabledReason : undefined}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!a.disabled) setDeleteOpen(true)
                }}
              >
                {a.icon}
                {a.label ?? 'Excluir'}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {del ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          action={del.action}
          title={del.title}
          description={del.description}
          confirmLabel={del.confirmLabel}
          confirmText={del.confirmText}
          loadImpact={del.loadImpact}
          onDeleted={del.onDeleted}
        />
      ) : null}
    </>
  )
}
