// Competência (accrual date) de um evento de domínio a partir do seu envelope
// (ADR 0016 D4). É a data do FATO GERADOR — quando a obrigação econômica se
// satisfaz — NÃO a data de gravação (`created_at`) nem de emissão (`timestamp`).
// Materializada na coluna `events.occurred_at` no append, pra o Razão fazer
// range-scan por competência (`readOrgEventStream`).
//
// Só eventos que compõem o Razão têm competência; os demais retornam null e não
// entram no livro. Função PURA — o write path (`writeEvent`) a chama com o
// `_tag` + payload do envelope; o mapa vive aqui (domínio), não na infra.
//
// Por fonte (ADR 0016 D2):
//   - order.closed       → `closedAt` (venda reconhecida na prestação)
//   - order.reopened     → `reopenedAt` (estorno reconhecido na data do estorno)
//   - commission.created → `data.createdAt` (= closedAt da comanda; a comissão
//                          nasce no fechamento e herda sua competência). Sem isso
//                          a comissão ficaria fora do range-scan por competência
//                          e o CSP sumiria da MC parcial.
//   - charge.succeeded   → `periodStartAt` (assinatura reconhecida no período de
//                          serviço, não no pagamento — regime de competência)
//   - charge.refunded    → `refundedAt` (contrapartida na competência do estorno)
export function competenceOf(tag: string, payload: Record<string, unknown>): string | null {
  switch (tag) {
    case 'order.closed':
      return readString(payload['closedAt'])
    case 'order.reopened':
      return readString(payload['reopenedAt'])
    case 'commission.created':
      return readNested(payload, 'data', 'createdAt')
    case 'charge.succeeded':
      // O produtor (`buildMarkPaidSteps`) carrega `periodStartAt` no changeset
      // justamente pra o evento ser auto-suficiente na competência (ADR 0016 D2).
      return readNested(payload, 'changes', 'periodStartAt')
    case 'charge.refunded':
      return readNested(payload, 'changes', 'refundedAt')
    default:
      return null
  }
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function readNested(payload: Record<string, unknown>, key: string, field: string): string | null {
  const nested = payload[key]
  if (nested !== null && typeof nested === 'object') {
    const record: Record<string, unknown> = { ...nested }
    return readString(record[field])
  }
  return null
}
