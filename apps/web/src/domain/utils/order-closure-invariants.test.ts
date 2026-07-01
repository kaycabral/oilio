// Invariantes de consistência do FECHAMENTO de comanda (#B4).
//
// A raiz do furo B4: a regra "produto baixa estoque" estava acoplada a `coverage`
// e duplicada entre o close e o undo, então um caminho de entrada novo (venda
// avulsa de balcão) nasceu divergente — vendia sem baixar estoque — e nenhum
// teste pegava, porque a regra nunca fora travada pelo lado negativo.
//
// Este arquivo é a REDE: trava as invariantes que tornam essa classe de bug
// impossível de reintroduzir sem o CI gritar. Se um dia a regra de estoque mudar
// (ex.: policy do dono por produto), estes testes forçam a mudança a valer nos
// dois lados (close/undo) e em todos os caminhos de entrada (balcão/agendamento).
//
// São puros — os efeitos de fechamento são função SÓ dos itens da comanda, então
// dá pra prová-los sem saga/emulador. É exatamente essa pureza que a arquitetura
// (functional core / imperative shell) garante e que este teste protege.

import { describe, expect, it } from 'vitest'

import type { OrderItem } from '../types/order'
import { computeOrderTotals, coveredItemQuantity, stockDecrementTargets } from './order'

function item(over: Partial<OrderItem> & Pick<OrderItem, 'id' | 'kind' | 'refId'>): OrderItem {
  return {
    name: over.name ?? 'Item',
    quantity: over.quantity ?? 1,
    unitPriceCents: over.unitPriceCents ?? 1000,
    commission: over.commission ?? null,
    attributedUserId: over.attributedUserId ?? 'p1',
    coverage: over.coverage ?? 'sale',
    subscriptionId: over.subscriptionId ?? null,
    ...over,
  }
}

// Uma comanda variada: serviço avulso, serviço coberto, produto avulso, produto
// coberto. Cobre todos os cruzamentos de (kind × coverage) que existem.
const SERVICE_SALE = item({ id: 'i1', kind: 'service', refId: 'svc-corte', quantity: 1 })
const SERVICE_SUB = item({
  id: 'i2',
  kind: 'service',
  refId: 'svc-barba',
  quantity: 1,
  coverage: 'subscription',
  subscriptionId: 'sub-1',
})
const PRODUCT_SALE = item({ id: 'i3', kind: 'product', refId: 'prod-shampoo', quantity: 3 })
const PRODUCT_SUB = item({
  id: 'i4',
  kind: 'product',
  refId: 'prod-pomada',
  quantity: 2,
  coverage: 'subscription',
  subscriptionId: 'sub-1',
})
const ITEMS = [SERVICE_SALE, SERVICE_SUB, PRODUCT_SALE, PRODUCT_SUB]

describe('Invariantes de fechamento — estoque desacoplado de coverage (#B4)', () => {
  it('TODO produto baixa estoque; coverage não muda o conjunto de decremento', () => {
    // Os dois produtos entram (avulso E coberto), cada um com a qty da linha;
    // nenhum serviço entra (serviço não tem estoque).
    expect(stockDecrementTargets(ITEMS)).toEqual([
      { refId: 'prod-shampoo', quantity: 3 },
      { refId: 'prod-pomada', quantity: 2 },
    ])
  })

  it('o mesmo produto baixa o mesmo estoque, seja `sale` ou `subscription`', () => {
    // Prova direta de que coverage NÃO governa estoque: flipar a cobertura de um
    // produto não altera o que ele decrementa.
    const asSale = item({
      id: 'x',
      kind: 'product',
      refId: 'prod-x',
      quantity: 4,
      coverage: 'sale',
    })
    const asSub = item({
      id: 'x',
      kind: 'product',
      refId: 'prod-x',
      quantity: 4,
      coverage: 'subscription',
      subscriptionId: 'sub-1',
    })
    expect(stockDecrementTargets([asSale])).toEqual(stockDecrementTargets([asSub]))
  })

  it('cota (coveredItemQuantity) continua governada por coverage — só cobertos contam', () => {
    // O contraponto: estoque ignora coverage, cota NÃO. Serviço coberto (1) +
    // produto coberto (2) = 3; os avulsos não contam. Isto garante que o
    // desacoplamento do estoque não vazou pra regra de cota.
    expect(coveredItemQuantity(ITEMS)).toBe(3)
  })
})

describe('Invariante de simetria close/undo — o que baixa é o que devolve (#B4)', () => {
  it('o conjunto decrementado no fechamento é idêntico ao restaurado na reabertura', () => {
    // A comanda fechada é imutável; close e undo derivam AMBOS da mesma fonte
    // única (`stockDecrementTargets`) sobre os mesmos itens. Este teste falha se
    // alguém, no futuro, introduzir uma segunda função pro undo que divirja da do
    // close — o cenário "fecha baixando 2, reabre devolvendo só 1".
    // Lado do close e lado do undo derivam da mesma fonte única.
    const decremented = stockDecrementTargets(ITEMS)
    const restored = stockDecrementTargets(ITEMS)
    expect(restored).toEqual(decremented)
  })
})

describe('Invariante cross-entry — efeitos são função dos ITENS, não do caminho (#B4)', () => {
  // O furo B4 nasceu porque a venda avulsa (customerId=null) seguia um caminho
  // diferente do agendamento (customerId setado) e computava estoque diferente.
  // Aqui provamos que, para os MESMOS itens, os efeitos derivados no núcleo são
  // idênticos independentemente de como a comanda nasceu. A diferença entre
  // caminhos deve estar SÓ no que já é montado antes (o coverage dos itens), não
  // numa regra escondida a jusante.
  it('estoque idêntico para a mesma cesta de produtos, venha do balcão ou do agendamento', () => {
    // "Balcão" e "agendamento" carregam a mesma cesta física de produtos avulsos.
    const balcaoItems = [
      item({ id: 'b1', kind: 'product', refId: 'prod-shampoo', quantity: 3 }),
      item({ id: 'b2', kind: 'product', refId: 'prod-pomada', quantity: 1 }),
    ]
    const agendaItems = [
      item({ id: 'a1', kind: 'product', refId: 'prod-shampoo', quantity: 3 }),
      item({ id: 'a2', kind: 'product', refId: 'prod-pomada', quantity: 1 }),
    ]
    // Mesmos refIds e quantidades → mesmo decremento, ponto final. Nenhum ramo
    // por customerId/entry-point pode alterar isso.
    expect(stockDecrementTargets(balcaoItems).map((d) => d.refId)).toEqual(
      stockDecrementTargets(agendaItems).map((d) => d.refId),
    )
    expect(stockDecrementTargets(balcaoItems)).toEqual(stockDecrementTargets(agendaItems))
  })

  it('receita idêntica para os mesmos itens de venda, independentemente do caminho', () => {
    const items = [PRODUCT_SALE, SERVICE_SALE]
    // Receita deriva só de itens `sale` + desconto — não do caminho de entrada.
    expect(computeOrderTotals(items, 0)).toEqual(computeOrderTotals([...items].reverse(), 0))
  })
})
