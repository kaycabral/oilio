// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo de commission
// (event-first: o fechamento da comanda emite `commission.created`, a marcação
// de pago emite `commission.updated`, sem write-only). created (snapshot) →
// updated (liquidação manual) → replay == projeção, campo a campo.
// Brief 0022 #998: comissão nasce `pendente`; eventos com estado legado de split
// continuam reconstruíveis (a migração para `pendente` é leitura, não rewrite).

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { liquidationStatusOf } from '../types/commission'
import { CommissionConfig } from './commission/config'

describe('Commission — replay reconstrói o doc completo (event-first)', () => {
  it('created (snapshot completo) → updated (marcado pago) → replay == projeção', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(CommissionConfig, 't1', 'c1')
    const data = {
      id: 'c1',
      orgId: 't1',
      orderId: 'o1',
      orderItemId: 'item-1',
      attributedUserId: 'pro-1',
      // Snapshot de identidade (brief 0041 AC-11): o nome do profissional vive no
      // próprio evento `created`, então o replay o reconstrói sem re-ler users/.
      attributedMemberName: 'Zé Profissional',
      itemKind: 'service',
      itemName: 'Corte',
      itemTotalCents: 10_000,
      commissionKind: 'percentage',
      commissionValue: 40,
      amountCents: 4_000,
      liquidationStatus: 'pendente',
      paidAt: null,
      paymentProof: null,
      createdAt: '2026-06-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CommissionConfig, ref, {
          _tag: 'commission.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(CommissionConfig, ref, {
          _tag: 'commission.updated',
          actorId: 'actor-1',
          payload: { changes: { liquidationStatus: 'pago', paidAt: '2026-06-02T09:00:00.000Z' } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(CommissionConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    expect(replayed.liquidationStatus).toBe('pago')
    expect(replayed.paidAt).toBe('2026-06-02T09:00:00.000Z')
    expect(replayed.amountCents).toBe(4_000)
    expect(replayed.createdAt).toBe('2026-06-01T12:00:00.000Z')
    expect(replayed.attributedUserId).toBe('pro-1')
    // O snapshot de identidade (AC-11) sobrevive ao replay — registro de retenção
    // self-contained, imune a revogado/anonimizado (não depende de users/).
    expect(replayed.attributedMemberName).toBe('Zé Profissional')
  })

  // Brief 0030 AC-07: comissão chaveada por MEMBRO (qualquer papel). Um produto
  // vendido pela recepção numa venda avulsa gera comissão chaveada pelo `userId`
  // do membro — NÃO um doc id de MemberOperation. O replay reconstrói o registro
  // keyed by member só pelos eventos (event-first), provando que comissionar
  // não-profissional é event-sourced de ponta a ponta.
  it('comissão de membro não-profissional (recepção) reconstrói por attributedUserId', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(CommissionConfig, 't1', 'c-reception')
    const data = {
      id: 'c-reception',
      orgId: 't1',
      orderId: 'o-standalone',
      orderItemId: 'item-product-1',
      // userId do membro recepção (não tem doc MemberOperation).
      attributedUserId: 'reception-user-1',
      attributedMemberName: 'Recepção',
      itemKind: 'product',
      itemName: 'Pomada modeladora',
      itemTotalCents: 6_000,
      commissionKind: 'percentage',
      commissionValue: 10,
      amountCents: 600,
      liquidationStatus: 'pendente',
      paidAt: null,
      paymentProof: null,
      createdAt: '2026-06-03T15:00:00.000Z',
    }

    await Effect.runPromise(
      appendEvent(CommissionConfig, ref, {
        _tag: 'commission.created',
        actorId: 'actor-1',
        payload: { data },
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(CommissionConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed.attributedUserId).toBe('reception-user-1')
    expect(replayed.itemKind).toBe('product')
    expect(replayed.amountCents).toBe(600)
    expect(liquidationStatusOf(replayed)).toBe('pendente')
  })

  it('eventos com estado legado de split continuam reconstruíveis (migração é leitura)', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(CommissionConfig, 't1', 'c-legacy')
    const data = {
      id: 'c-legacy',
      orgId: 't1',
      orderId: 'o1',
      orderItemId: 'item-1',
      attributedUserId: 'pro-1',
      attributedMemberName: 'Zé Profissional',
      itemKind: 'service',
      itemName: 'Corte',
      itemTotalCents: 10_000,
      commissionKind: 'percentage',
      commissionValue: 40,
      amountCents: 4_000,
      // Estado legado gravado antes do colapso (brief 0004): comissões antigas
      // não carregam `liquidationStatus` — a ausência é lida como `pendente` por
      // `liquidationStatusOf` (tolerância de leitura, não rewrite destrutivo).
      createdAt: '2026-05-01T12:00:00.000Z',
    }

    await Effect.runPromise(
      appendEvent(CommissionConfig, ref, {
        _tag: 'commission.created',
        actorId: 'actor-1',
        payload: { data },
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(CommissionConfig, ref).pipe(Effect.provide(layer)),
    )

    // Replay preserva o evento gravado (append-only, sem rewrite). A migração
    // para `pendente` é feita na leitura via `liquidationStatusOf`.
    expect(replayed).toEqual(projection)
    expect(liquidationStatusOf(replayed)).toBe('pendente')
  })

  // AC-04 (brief 0022 #999): a reabertura da comanda estorna a comissão pendente
  // via `commission.deleted` (marca o stream; o read model é hard-deleted pelo
  // caller). O stream permanece como verdade e o replay reconstrói o último
  // estado conhecido — a reversão é auditável, nunca silenciosa.
  it('created (pendente) → deleted (reversão na reabertura) — replay mantém o stream', async () => {
    const { layer } = makeReplayStore()
    const ref = aggregateRef(CommissionConfig, 't1', 'c-reversed')
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(CommissionConfig, ref, {
          _tag: 'commission.created',
          actorId: 'actor-1',
          payload: {
            data: {
              id: 'c-reversed',
              orgId: 't1',
              orderId: 'o1',
              orderItemId: 'item-1',
              attributedUserId: 'pro-1',
              attributedMemberName: 'Zé Profissional',
              itemKind: 'service',
              itemName: 'Corte',
              itemTotalCents: 10_000,
              commissionKind: 'percentage',
              commissionValue: 40,
              amountCents: 4_000,
              liquidationStatus: 'pendente',
              paidAt: null,
              paymentProof: null,
              createdAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(CommissionConfig, ref, {
          _tag: 'commission.deleted',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const replayed = await Effect.runPromise(
      replayAggregate(CommissionConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(replayed._version).toBe(2)
    expect(liquidationStatusOf(replayed)).toBe('pendente')
  })
})
