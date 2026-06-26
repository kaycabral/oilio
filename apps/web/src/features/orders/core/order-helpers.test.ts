import type { CatalogProductItem, CatalogServiceItem, OrderItem } from '@/domain'
import { describe, expect, it } from 'vitest'
import {
  parseItemForm,
  parsePaymentMethod,
  recalcAndPatch,
  snapshotCatalogItem,
  validateClosableItems,
  type ParsedItem,
} from './order-helpers'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function service(over: Partial<CatalogServiceItem> = {}): CatalogServiceItem {
  return {
    id: 'svc-1',
    orgId: 't1',
    name: 'Corte',
    categoryId: null,
    priceCents: 8000,
    commission: null,
    unitIds: ['u1'],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    kind: 'service',
    durationMinutes: 30,
    requiredResources: [],
    ...over,
  }
}

function product(over: Partial<CatalogProductItem> = {}): CatalogProductItem {
  const { durationMinutes: _d, requiredResources: _r, kind: _k, ...base } = service()
  return {
    ...base,
    id: 'prod-1',
    name: 'Pomada',
    priceCents: 3000,
    kind: 'product',
    sku: null,
    stock: 10,
    gtin14: null,
    ...over,
  }
}

function parsed(over: Partial<ParsedItem> = {}): ParsedItem {
  return {
    kind: 'service',
    refId: 'svc-1',
    quantity: 1,
    attributedUserId: 'user-1',
    displayedPriceCents: null,
    ...over,
  }
}

describe('parseItemForm', () => {
  it('parses a valid service item', () => {
    expect(
      parseItemForm(
        form({ kind: 'service', refId: 'svc-1', quantity: '1', attributedUserId: 'u9' }),
      ),
    ).toEqual({
      kind: 'service',
      refId: 'svc-1',
      quantity: 1,
      attributedUserId: 'u9',
      displayedPriceCents: null,
    })
  })

  it('rejects an invalid kind / missing refId', () => {
    expect(parseItemForm(form({ kind: 'combo', refId: 'x', quantity: '1' }))).toBe(
      'Tipo de item inválido',
    )
    expect(parseItemForm(form({ kind: 'service', quantity: '1' }))).toBe('Serviço é obrigatório')
    expect(parseItemForm(form({ kind: 'product', quantity: '1' }))).toBe('Produto é obrigatório')
  })

  it('rejects invalid quantity (NaN, ≤0, >999)', () => {
    expect(parseItemForm(form({ kind: 'product', refId: 'p', quantity: 'x' }))).toBe(
      'Quantidade inválida',
    )
    expect(parseItemForm(form({ kind: 'product', refId: 'p', quantity: '0' }))).toBe(
      'Quantidade inválida',
    )
    expect(parseItemForm(form({ kind: 'product', refId: 'p', quantity: '1000' }))).toBe(
      'Quantidade inválida',
    )
  })

  it('forces services to quantity 1', () => {
    expect(parseItemForm(form({ kind: 'service', refId: 's', quantity: '2' }))).toBe(
      'Serviço sempre tem quantidade 1 — adicione outro item se precisar',
    )
  })

  it('floors product quantity and keeps multi-unit', () => {
    const r = parseItemForm(form({ kind: 'product', refId: 'p', quantity: '3.9' }))
    expect(typeof r === 'object' && r.quantity).toBe(3)
  })

  it('parses an optional displayed price, rejecting a negative/non-integer one', () => {
    const parsed = parseItemForm(
      form({ kind: 'product', refId: 'p', quantity: '1', displayedPriceCents: '4500' }),
    )
    if (typeof parsed === 'string') throw new Error(`expected a parsed item, got: ${parsed}`)
    expect(parsed.displayedPriceCents).toBe(4500)
    expect(
      parseItemForm(
        form({ kind: 'product', refId: 'p', quantity: '1', displayedPriceCents: '-1' }),
      ),
    ).toBe('Preço exibido inválido')
  })
})

describe('snapshotCatalogItem — lawful pricing (CDC art. 30)', () => {
  it('uses the live price when no displayed price was threaded', () => {
    const snap = snapshotCatalogItem(
      service({ priceCents: 8000 }),
      parsed({ displayedPriceCents: null }),
      'u1',
    )
    expect(typeof snap === 'object' && snap.unitPriceCents).toBe(8000)
  })

  it('charges the lower of displayed vs live (never above displayed)', () => {
    // displayed below live → honor the displayed (the offer binds)
    const lower = snapshotCatalogItem(
      service({ priceCents: 8000 }),
      parsed({ displayedPriceCents: 5000 }),
      'u1',
    )
    expect(typeof lower === 'object' && lower.unitPriceCents).toBe(5000)
    // live dropped below displayed → consumer benefits from the lower live
    const dropped = snapshotCatalogItem(
      service({ priceCents: 7000 }),
      parsed({ displayedPriceCents: 9000 }),
      'u1',
    )
    expect(typeof dropped === 'object' && dropped.unitPriceCents).toBe(7000)
  })

  it('rejects a missing / wrong-kind / discontinued item', () => {
    expect(snapshotCatalogItem(null, parsed({ kind: 'service' }), 'u1')).toBe(
      'Serviço não encontrado',
    )
    expect(snapshotCatalogItem(null, parsed({ kind: 'product' }), 'u1')).toBe(
      'Produto não encontrado',
    )
    expect(snapshotCatalogItem(product(), parsed({ kind: 'service' }), 'u1')).toBe(
      'Item não é um serviço',
    )
    expect(snapshotCatalogItem(service(), parsed({ kind: 'product' }), 'u1')).toBe(
      'Item não é um produto',
    )
    expect(snapshotCatalogItem(service({ active: false }), parsed({ kind: 'service' }), 'u1')).toBe(
      'Serviço descontinuado',
    )
    expect(
      snapshotCatalogItem(service({ archivedAt: 'x' }), parsed({ kind: 'service' }), 'u1'),
    ).toBe('Serviço descontinuado')
  })
})

describe('recalcAndPatch', () => {
  it('recomputes subtotal/total from items + discount', () => {
    const items: OrderItem[] = [
      { ...baseItem(), unitPriceCents: 5000, quantity: 2 },
      { ...baseItem(), id: 'i2', unitPriceCents: 3000, quantity: 1 },
    ]
    const patch = recalcAndPatch(items, 1000)
    expect(patch.subtotalCents).toBe(13000)
    expect(patch.totalCents).toBe(12000)
    expect(patch.discountCents).toBe(1000)
    expect(patch.items).toBe(items)
  })
})

describe('parsePaymentMethod', () => {
  it('accepts known methods, rejects garbage', () => {
    expect(parsePaymentMethod('cash')).toBe('cash')
    expect(parsePaymentMethod('bitcoin')).toBeNull()
    expect(parsePaymentMethod('')).toBeNull()
  })
})

describe('validateClosableItems', () => {
  it('rejects an empty cart', () => {
    expect(validateClosableItems([])).toBe('Venda vazia — adicione pelo menos um item')
  })

  it('rejects an item without an attributed member', () => {
    expect(validateClosableItems([{ ...baseItem(), name: 'Corte', attributedUserId: '' }])).toBe(
      'Item "Corte" sem membro atribuído',
    )
  })

  it('accepts a cart where every item has a member', () => {
    expect(validateClosableItems([baseItem(), { ...baseItem(), id: 'i2' }])).toBeNull()
  })
})

function baseItem(): OrderItem {
  return {
    id: 'i1',
    kind: 'product',
    refId: 'p1',
    name: 'Item',
    quantity: 1,
    unitPriceCents: 1000,
    commission: null,
    attributedUserId: 'user-1',
  }
}
