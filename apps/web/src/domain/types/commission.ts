import { Schema } from 'effect'

import { NonEmptyString } from '@/domain/value-objects'
import { OrderItemKind } from './order'

// Liquidation status of a commission (brief 0022 #998). Collapsed from the 5
// legacy split states to the manual model: a commission is born `pendente` when
// the order closes and becomes `pago` once the owner settles it by hand
// (Pix/cash) — brief 0022 Grupo A.
export const LIQUIDATION_STATUSES = ['pendente', 'pago'] as const
export const LiquidationStatus = Schema.Literal(...LIQUIDATION_STATUSES)
export type LiquidationStatus = typeof LiquidationStatus.Type

// Migration (brief 0022 #998): commissions written before the collapse carry a
// legacy split state (auto_split, simulated_split, manual_only, manual_pending,
// manual_done). None were ever settled via gateway, so any value other than
// `pago` reads as `pendente`. Tolerance is read-time, not a destructive rewrite.
export function liquidationStatusOf(c: { liquidationStatus?: string }): LiquidationStatus {
  return c.liquidationStatus === 'pago' ? 'pago' : 'pendente'
}

// Registro append-only de comissão gerada quando uma order é fechada.
// Um por item da order com `commission != null`. Imutável — para corrigir,
// abrir outro registro de ajuste (fora do escopo do V0).
// `CommissionFields` é a base não-filtrada usada pelos eventos (`Schema.partial`
// não atravessa o refinement); `Commission` aplica o refinamento pra leitura.
export const CommissionFields = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    orderId: Schema.String,
    // Item da order que gerou esta comissão. Permite re-conciliar / auditar.
    // Não-vazio (#1283): sem FK no banco, é a única defesa contra `''` que
    // quebraria a reconciliação comissão↔item.
    orderItemId: NonEmptyString,
    // Membro a quem a comissão é creditada (brief 0030, AC-07). É o `userId` do
    // membro atribuído ao item (`OrderItem.attributedUserId`), NÃO o doc id de um
    // MemberOperation — qualquer papel (recepção, vendedor) pode ser comissionado.
    // Para serviços executados por profissional, este `userId` é a mesma
    // identidade do MemberOperation, então o agrupamento por membro segue exibindo a
    // linha do profissional. Não-vazio (#1283): sem FK (snapshot global de uid),
    // `''` agruparia lixo no relatório por membro.
    attributedUserId: NonEmptyString,
    // Nome identificável do profissional/membro atribuído, SNAPSHOTADO no momento
    // da apuração (brief 0041 AC-11). Registro de RETENÇÃO de vínculo (art. 16): a
    // identidade tem que sobreviver mesmo que o membro seja revogado (offboarding
    // #1103), suspenso ou anonimizado-como-cliente — casos em que o join ao vivo
    // (`listOrgMembers`, `status==active`) dropa o membro e o relatório
    // mostrava "--". O relatório lê este snapshot, não o join ao vivo. Vazio
    // quando não há membro atribuído ou ele não pôde ser resolvido na apuração —
    // nunca lança. Distinto do contrato D2 "PII fora de evento" (ADR 0010), que
    // governa PII de CLIENTE / direito à eliminação; aqui é retenção de vínculo.
    attributedMemberName: Schema.String,
    itemKind: OrderItemKind,
    // Rótulo do item snapshotado — não-vazio (#1283): linha de comissão sem nome.
    itemName: NonEmptyString,
    // Preço do item × quantidade no momento do fechamento (snapshot).
    itemTotalCents: Schema.Number,
    // Regra aplicada (snapshot). `value` segue convenção do CommissionRule:
    // percentage → 0–100, fixed → centavos.
    commissionKind: Schema.Literal('percentage', 'fixed'),
    commissionValue: Schema.Number,
    // Valor calculado da comissão em centavos.
    amountCents: Schema.Number,
    // Liquidação manual (brief 0022 #998). Nasce `pendente` no fechamento; vira
    // `pago` quando o owner marca como pago (slice 2, #999). Ausente em comissões
    // antigas → lido como `pendente` via `liquidationStatusOf`.
    liquidationStatus: Schema.optional(LiquidationStatus),
    // Pagamento manual concluído (brief 0022 Grupo B, #999): `paidAt` registra o
    // momento e `paymentProof` guarda a referência opcional do comprovante
    // (ex.: link do print do Pix).
    paidAt: Schema.optional(Schema.NullOr(Schema.String)),
    paymentProof: Schema.optional(Schema.NullOr(Schema.String)),
    // = order.closedAt
    createdAt: Schema.String,
  }),
)

// `paidAt` existe SSE a comissão está paga (`liquidationStatusOf` tolera o legado
// ausente como `pendente`) — fecha "paga sem data" e "pendente com data".
export const Commission = CommissionFields.pipe(
  Schema.filter((c) => (liquidationStatusOf(c) === 'pago' ? c.paidAt != null : c.paidAt == null), {
    message: () => 'paidAt deve existir sse a comissão está paga',
  }),
)
export type Commission = typeof Commission.Type
