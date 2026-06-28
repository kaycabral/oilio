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

// What removing the row will affect, loaded lazily when the dialog opens
// (brief 0033, AC-10). `lines` is the human-readable "isto vai…" list; a non-null
// `blockedReason` means the deletion is refused (e.g. an open comanda) — the
// destructive button stays disabled and the reason shows.
export type DeletionImpact = { lines: string[]; blockedReason?: string | null }

// Shared confirm contract — the inputs that describe a destructive deletion.
// Both the standalone `DeleteAction` (own trigger) and the `RowActions` ⋯ menu
// (external trigger) drive the same `ConfirmDeleteDialog` with this shape.
export type ConfirmDeleteProps = {
  action: () => Promise<MutationResult>
  title: string
  description: string
  confirmLabel?: string
  // High impact: require typing this exact text (the entity name) to enable the
  // destructive button.
  confirmText?: string
  // High impact: fetch + render what will be lost when the dialog opens.
  loadImpact?: () => Promise<DeletionImpact>
  // Optional client-side follow-up (e.g. router.refresh) on success.
  onDeleted?: () => void
}

// Controlled confirm dialog (no trigger of its own) — open state is owned by the
// caller, so it works both behind the standalone button below AND as a ⋯ menu
// item (see `RowActions`). Keeps the full safe-confirm pattern (brief 0033,
// AC-10): inverted footer, lazy impact loss-list, optional type-to-confirm.
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
  // Safety focus (AC-10): the prominent "Cancelar" gets focus when the dialog
  // opens, so a reflex Enter never confirms the destructive action.
  const cancelRef = useRef<HTMLButtonElement>(null)
  // `loadImpact` identity may change per render (callers build it inline); keep
  // it in a ref so the open-effect depends only on `open`.
  const loadImpactRef = useRef(loadImpact)
  loadImpactRef.current = loadImpact

  // Opening (driven by the caller's state) resets the dialog and lazily loads
  // the impact loss-list.
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
        // Keep the dialog open so the failure reads in context.
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

        {/* INVERTED footer (AC-10): destructive on the left, the prominent
            auto-focused "Cancelar" on the right — a reflex click never confirms. */}
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

// Single destructive-action widget (brief 0033 — #1070). ONE "Excluir" verb
// across every entity surface; clicking opens the shared Radix AlertDialog
// (never the native `confirm()`). Whether the server hard-deletes or soft-deletes
// is decided server-side — the UI never exposes "Arquivar". This is the
// standalone (own-trigger) form; for a ⋯ overflow menu use `RowActions`, which
// drives the same `ConfirmDeleteDialog`.
//
// Disabled tier (kept for memberOperation, where an active membership hard-blocks
// and the lifecycle is a separate offboarding flow, 0041): `canDelete={false}` +
// `disabledReason` renders a disabled trigger that explains itself.
export function DeleteAction({
  triggerLabel = 'Excluir',
  canDelete = true,
  disabledReason,
  ...confirm
}: ConfirmDeleteProps & {
  triggerLabel?: string
  // When false, the action is impossible for this row → disabled trigger.
  canDelete?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)

  // Impossible action → a disabled trigger that explains itself (never an
  // AlertDialog that errors on confirm).
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
