import type { LedgerEntry } from '@/domain/types/ledger'
import { Context, type Effect } from 'effect'

// Ports de fonte externa do Razão (brief 0091, AC-04 `[edge]`). A costura pra a
// Onda 3 da iniciativa Gestão Financeira: quando impostos/MDR/CMV/despesas
// deixarem de ser manuais e passarem a ser ingeridos de fontes externas
// (adquirente, fiscal, banco), cada fonte vira um Adapter destes Ports — e o
// Razão os consome do mesmo jeito que consome os fatos internos, sem reescrever
// o core (Linguagem § "Fundamento dita, ferramenta serve").
//
// NENHUM adapter é implementado nesta fundação — só a interface existe, provando
// que a modelagem cresce sem tocar o núcleo. O tipo de retorno é `LedgerEntry[]`:
// a normalização provedor→fato canônico (ACL) mora no adapter, não aqui.

// Janela de leitura que toda fonte externa recebe (org/unidade/período).
export interface LedgerSourceWindow {
  readonly orgId: string
  readonly unitId: string
  readonly fromIso: string
  readonly toIso: string
}

// Operações que uma fonte externa de fatos financeiros expõe. `E = unknown` até
// o primeiro adapter definir seus erros de normalização/transporte.
export interface LedgerSourceOps {
  readonly fetchEntries: (
    window: LedgerSourceWindow,
  ) => Effect.Effect<readonly LedgerEntry[], unknown>
}

// Adquirente (maquininha): receita cartão + MDR (custo variável automático) +
// recebíveis. O 1º custo variável a automatizar quando a parceria de pagamento
// ligar (Mapa de Módulos § Ferramentas).
export class AcquirerLedgerPort extends Context.Tag('AcquirerLedgerPort')<
  AcquirerLedgerPort,
  LedgerSourceOps
>() {}

// Fiscal (NF-e de compra / regime via CNAE): CMV/insumos e imposto s/ venda.
export class FiscalLedgerPort extends Context.Tag('FiscalLedgerPort')<
  FiscalLedgerPort,
  LedgerSourceOps
>() {}

// Banco (Open Finance): extrato = despesas reais + fluxo + conciliação. Alimenta
// o sistema de Caixa/Liquidez (outra iniciativa) e despesa fixa no Razão.
export class BankLedgerPort extends Context.Tag('BankLedgerPort')<
  BankLedgerPort,
  LedgerSourceOps
>() {}
