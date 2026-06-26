'use client'

import { addItemToOrder } from '@/features/orders/adapters/orders.actions'
import {
  attributionLabel,
  clampQuantity,
  filterCatalog,
  formatBRL,
  type CatalogOption,
} from '@/features/orders/core/order-detail-format'
import type { OrgMember } from '@/shared/org/membership'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

export function OrderAddItemForm({
  orderId,
  catalogOptions,
  members,
  defaultUserId,
  pending,
  onPending,
  onDone,
}: {
  orderId: string
  catalogOptions: CatalogOption[]
  members: OrgMember[]
  // Default esperto da atribuição (brief 0030, AC-04): o `userId` do membro que
  // abriu a venda (o operador). Espelha o default do servidor — todo item
  // adicionado pela UI nasce atribuído ao operador, editável pra outro membro.
  // (O serviço do agendamento já nasce atribuído ao profissional no
  // `startAttendance`.)
  defaultUserId: string
  pending: boolean
  onPending: (cb: () => void | Promise<void>) => void
  onDone: () => void
}) {
  // Tracks the picked item so quantity can lock to 1 for services (a service
  // line is always qty 1 — duration/commission are per execution).
  const [selected, setSelected] = useState<CatalogOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  // POS quick-search (brief 0030, AC-10): filters the catalog picker by name OR
  // code (product SKU), case/accent-insensitive. Plain client-side filter — no
  // extra read. The `<select>` stays the source of truth so existing
  // selectOption-driven flows keep working; it just renders the filtered subset.
  const [search, setSearch] = useState('')
  const [quantity, setQuantity] = useState(1)
  const isService = selected?.kind === 'service'
  // Rótulo do controle de atribuição segue o `kind` do item escolhido (AC-04).
  const attributionFieldLabel = selected ? attributionLabel(selected.kind) : 'Membro'

  const filteredOptions = useMemo(
    () => filterCatalog(catalogOptions, search),
    [catalogOptions, search],
  )

  const effectiveQuantity = clampQuantity(quantity, isService)

  function pick(option: CatalogOption | null) {
    setSelected(option)
    // Pular o stepper pra serviço (qty travada em 1).
    if (option?.kind === 'service') setQuantity(1)
  }

  function onSubmit(formData: FormData) {
    setError(null)
    if (!selected) {
      setError('Selecione um item do catálogo')
      return
    }
    // `kind` is inferred from the chosen catalog item, never declared upfront.
    formData.set('kind', selected.kind)
    formData.set('refId', selected.id)
    formData.set('quantity', String(effectiveQuantity))
    // Preço exibido ao operador (brief 0033 AC-09): o server cobra
    // `min(exibido, vigente)` no commit transacional, nunca mais que o exibido.
    formData.set('displayedPriceCents', String(selected.priceCents))
    onPending(async () => {
      const res = await addItemToOrder(orderId, formData)
      if (!res.ok) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      // Reset POS state ao sucesso pra encadear vendas rápidas (AC-10).
      setSelected(null)
      setSearch('')
      setQuantity(1)
      onDone()
    })
  }

  return (
    <form
      action={onSubmit}
      className="border-border bg-muted/20 grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
    >
      {/* AC-10: busca rápida por nome ou código do catálogo. */}
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar item por nome ou código…"
        className="col-span-full sm:col-span-1"
        aria-label="Buscar item do catálogo"
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-item-catalog">Item do catálogo</Label>
        <Select
          required
          value={selected ? `${selected.kind}:${selected.id}` : ''}
          onValueChange={(value) => {
            pick(catalogOptions.find((o) => `${o.kind}:${o.id}` === value) ?? null)
          }}
        >
          <SelectTrigger id="add-item-catalog">
            <SelectValue
              placeholder={
                filteredOptions.length === 0 ? 'Nenhum item encontrado' : 'Selecione item…'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {filteredOptions.map((c) => (
              <SelectItem key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                {c.name}
                {c.code ? ` · ${c.code}` : ''} · {c.kind === 'service' ? 'serviço' : 'produto'} ·{' '}
                {formatBRL(c.priceCents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-item-attribution">{attributionFieldLabel}</Label>
        <Select name="attributedUserId" required defaultValue={defaultUserId}>
          <SelectTrigger id="add-item-attribution">
            <SelectValue placeholder={`${attributionFieldLabel}…`} />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* AC-10: ajuste rápido de quantidade com steppers (− / +). */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-8 px-0"
          disabled={isService || effectiveQuantity <= 1}
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          aria-label="Diminuir quantidade"
        >
          −
        </Button>
        <Input
          name="quantity"
          type="number"
          min={1}
          max={999}
          value={effectiveQuantity}
          onChange={(e) => setQuantity(Number(e.target.value) || 1)}
          disabled={isService}
          className="w-16 text-center"
          aria-label="Quantidade"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-8 px-0"
          disabled={isService || effectiveQuantity >= 999}
          onClick={() => setQuantity((q) => Math.min(999, q + 1))}
          aria-label="Aumentar quantidade"
        >
          +
        </Button>
      </div>
      <Button type="submit" disabled={pending}>
        Adicionar item
      </Button>
      {error ? <p className="text-destructive col-span-full text-sm">{error}</p> : null}
    </form>
  )
}
