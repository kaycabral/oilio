'use client'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from '@cbrl/design'
import { useEffect, useId, useRef, useState, useTransition } from 'react'

export type MutationResult = { ok: true } | { ok: false; error: string }

export type DeletionImpact = { lines: string[]; blockedReason?: string | null }

export type ConfirmDeleteProps = {
  action: () => Promise<MutationResult>
  title: string
  description: string
  confirmLabel?: string
  confirmText?: string
  loadImpact?: () => Promise<DeletionImpact>
  onDeleted?: () => void
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  action,
  title,
  description,
  confirmLabel = 'Excluir',
  confirmText,
  loadImpact,
  onDeleted,
}: ConfirmDeleteProps & {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [impact, setImpact] = useState<DeletionImpact | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const confirmInputId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const loadImpactRef = useRef(loadImpact)
  loadImpactRef.current = loadImpact

  useEffect(() => {
    if (!open) return
    setError(null)
    setTyped('')
    setImpact(null)
    cancelRef.current?.focus()
    const li = loadImpactRef.current
    if (li) {
      setLoadingImpact(true)
      li()
        .then((i) => setImpact(i))
        .catch(() =>
          setImpact({ lines: [], blockedReason: 'Não foi possível carregar o impacto.' }),
        )
        .finally(() => setLoadingImpact(false))
    }
  }, [open])

  function onConfirm() {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) {
        setError(res.error)
        return
      }
      onOpenChange(false)
      onDeleted?.()
    })
  }

  const blockedReason = impact?.blockedReason ?? null
  const typedOk = !confirmText || typed.trim() === confirmText.trim()
  const confirmDisabled = pending || loadingImpact || Boolean(blockedReason) || !typedOk

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {loadingImpact ? (
          <p className="text-muted-foreground text-sm">Verificando vínculos…</p>
        ) : null}

        {impact && impact.lines.length > 0 ? (
          <div className="text-sm">
            <p className="mb-1 font-medium">Isto vai:</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              {impact.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {blockedReason ? <p className="text-destructive text-sm">{blockedReason}</p> : null}

        {confirmText && !blockedReason ? (
          <label className="block text-sm" htmlFor={confirmInputId}>
            <span className="text-muted-foreground">
              Digite <strong className="text-foreground">{confirmText}</strong> para confirmar
            </span>
            <Input
              id={confirmInputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              autoComplete="off"
              className="mt-1"
              aria-label="Confirmar digitando o nome"
            />
          </label>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <AlertDialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? 'Excluindo…' : confirmLabel}
          </Button>
          <Button
            ref={cancelRef}
            type="button"
            variant="default"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeleteAction({
  triggerLabel = 'Excluir',
  canDelete = true,
  disabledReason,
  ...confirm
}: ConfirmDeleteProps & {
  triggerLabel?: string
  canDelete?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)

  if (!canDelete) {
    return (
      <span className="inline-flex flex-col items-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-2 text-xs"
          disabled
          title={disabledReason}
          aria-label={disabledReason ? `${triggerLabel} — ${disabledReason}` : triggerLabel}
        >
          {triggerLabel}
        </Button>
        {disabledReason ? (
          <span className="text-muted-foreground mt-1 max-w-[16rem] text-right text-xs">
            {disabledReason}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-2 text-xs"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <ConfirmDeleteDialog open={open} onOpenChange={setOpen} {...confirm} />
    </span>
  )
}
