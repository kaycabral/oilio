'use client'

import type { AgendaBlock, StoredUnit } from '@/domain'
import { deleteBlock } from '@/features/agenda/adapters/blocks.actions'
import { oneOffToLocal } from '@/features/agenda/core/block-time'
import { type BlockOwner, BlockForm } from '@/features/agenda/ui/BlockForm'
import { Button } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'

const WEEKDAY_LABEL: Record<string, string> = {
  monday: 'seg',
  tuesday: 'ter',
  wednesday: 'qua',
  thursday: 'qui',
  friday: 'sex',
  saturday: 'sáb',
  sunday: 'dom',
}

function describeWhen(block: AgendaBlock, tz: string): string {
  if (block.kind === 'recurring') {
    return `${WEEKDAY_LABEL[block.weekday] ?? block.weekday} ${block.open}–${block.close}`
  }
  const local = oneOffToLocal(block.startAt, block.endAt, tz)
  return `${local.date} ${local.start}–${local.end}`
}

// Embeddable agenda-block manager (brief 0036). Lives wherever the blocked time
// is owned: the unit config (unit-wide blocks) or the professional member detail
// (per-professional blocks). Create/edit happen inline (no dedicated route); the
// list refreshes in place after every mutation.
export function BlocksSection({
  owner,
  blocks,
  tenantTimezone,
  canManage,
  title,
  description,
}: {
  owner: BlockOwner
  blocks: AgendaBlock[]
  tenantTimezone: string
  canManage: boolean
  title: string
  description: string
}) {
  const router = useRouter()
  const titleId = useId()
  const [pending, startTransition] = useTransition()
  // `null` = no form open; 'new' = create; otherwise the block id being edited.
  const [editing, setEditing] = useState<string | null>(null)

  const unitNameById = new Map(
    (owner.scope === 'professional' ? owner.units : ([] as StoredUnit[])).map((u) => [
      u.id,
      u.name,
    ]),
  )
  const showUnitColumn = owner.scope === 'professional' && owner.units.length > 1

  function done() {
    setEditing(null)
    router.refresh()
  }

  return (
    <section className="border-border space-y-3 rounded-md border p-4" aria-labelledby={titleId}>
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        {canManage && editing !== 'new' ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing('new')}>
            Novo bloqueio
          </Button>
        ) : null}
      </header>

      {editing === 'new' ? (
        <div className="border-border rounded-md border border-dashed p-3">
          <BlockForm owner={owner} tenantTimezone={tenantTimezone} onDone={done} />
        </div>
      ) : null}

      {blocks.length === 0 && editing !== 'new' ? (
        <p className="text-muted-foreground text-sm">Nenhum bloqueio cadastrado.</p>
      ) : (
        <ul className="divide-border divide-y">
          {blocks.map((b) =>
            editing === b.id ? (
              <li key={b.id} className="py-3">
                <div className="border-border rounded-md border border-dashed p-3">
                  <BlockForm
                    owner={owner}
                    block={b}
                    tenantTimezone={tenantTimezone}
                    onDone={done}
                  />
                </div>
              </li>
            ) : (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{b.reason}</span>
                  <span className="text-muted-foreground ml-2">
                    {describeWhen(b, tenantTimezone)}
                  </span>
                  {showUnitColumn ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      · {unitNameById.get(b.unitId) ?? '—'}
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => setEditing(b.id)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Excluir bloqueio "${b.reason}"?`)) return
                        startTransition(async () => {
                          await deleteBlock(b.id)
                          router.refresh()
                        })
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
