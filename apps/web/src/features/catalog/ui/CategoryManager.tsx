'use client'

import { DeleteAction, type DeletionImpact } from '@/components/destructive/DeleteAction'
import type { Category } from '@/domain'
import {
  createCategory,
  deleteCategory,
  getCategoryDeletionImpactAction,
} from '@/features/categories/adapters/categories.actions'
import { Button, Input, Label } from '@cbrl/design'
import { useState, useTransition } from 'react'

function buildCategoryImpact(categoryId: string): () => Promise<DeletionImpact> {
  return async () => {
    const r = await getCategoryDeletionImpactAction(categoryId)
    if ('error' in r) return { lines: [], blockedReason: r.error }
    if (r.itemCount === 0) return { lines: [] }
    return {
      lines: [`Deixar ${r.itemCount} ${r.itemCount > 1 ? 'itens' : 'item'} sem categoria`],
    }
  }
}

export function CategoryManager({
  categories,
  canManage,
  canDelete,
}: {
  categories: Category[]
  canManage: boolean
  canDelete: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onCreate(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createCategory(formData)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <section className="border-border space-y-3 rounded-md border p-4">
      <header>
        <h2 className="text-lg font-semibold">Categorias</h2>
        <p className="text-muted-foreground text-sm">
          Organize serviços e produtos. As categorias alimentam o filtro acima e o seletor de
          categoria do item.
        </p>
      </header>

      {categories.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma categoria cadastrada ainda.</p>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>{c.name}</span>
              {canDelete ? (
                <DeleteAction
                  action={() => deleteCategory(c.id)}
                  title={`Excluir categoria "${c.name}"?`}
                  description="Os itens desta categoria passam a aparecer como “Sem categoria”. Pedidos, relatórios e assinaturas não são afetados."
                  loadImpact={buildCategoryImpact(c.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form action={onCreate} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="category-name" className="text-muted-foreground text-xs font-medium">
              Nova categoria
            </Label>
            <Input
              id="category-name"
              name="name"
              placeholder="Ex.: Cabelo, Barba, Cosméticos"
              required
              minLength={2}
            />
          </div>
          <input type="hidden" name="active" value="on" />
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : 'Adicionar'}
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </section>
  )
}
