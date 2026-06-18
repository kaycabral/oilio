// AC-05 (brief 0032 — LGPD exclusão/anonimização) `[critical] [smoke]`:
// **PII NUNCA em snapshot/evento.** Auditoria determinística + regression gate
// do invariante canônico do ADR 0010 ("PII fora do payload de evento").
//
// Como funciona:
//   - Cada aggregate event-sourced expõe um `INITIAL_*_STATE` que ENUMERA todos
//     os campos do snapshot persistido (o doc que a projeção deriva do stream).
//   - O evento `*.created` carrega esse snapshot (`payload.data: StoredX`) e os
//     reducers tipam `data`/`changes` como `Partial<XState>` — logo o shape do
//     payload de evento == o shape do snapshot. Guardar o snapshot guarda o
//     evento.
//   - Este teste varre recursivamente todo nome de campo de cada snapshot e
//     FALHA se algum casar com um token de PII de titular (nome/WhatsApp/email/
//     CPF/CNPJ/endereço/nascimento). Identidade tem que ser por REFERÊNCIA (id),
//     nunca cópia do valor.
//
// Refs NÃO são PII e são esperadas: `*Id`/`*UserId` (`attributedUserId`,
// `customerId`, `professionalId`, `userId`) são FKs opacos — o padrão CORRETO.
// O denylist mira VALORES de PII copiados num payload/snapshot, não ids.
//
// Pega o caso do futuro: um dev que adicione `name`/`whatsapp`/`email`/`cpf`/...
// num snapshot quebra este teste no commit que introduz o vazamento.

import { describe, expect, it } from 'vitest'

import type { OrderItem } from '@/domain/types/order'

import { INITIAL_AGENDA_BLOCK_STATE } from './agenda-block/types'
import { INITIAL_APPOINTMENT_STATE } from './appointment/types'
import { INITIAL_CASH_MOVEMENT_STATE } from './cash-movement/types'
import { INITIAL_CATALOG_ITEM_STATE } from './catalog-item/types'
import { INITIAL_CATEGORY_STATE } from './category/types'
import { INITIAL_CHARGE_STATE } from './charge/types'
import { INITIAL_COMMISSION_STATE } from './commission/types'
import { INITIAL_CUSTOMER_STATE } from './customer/types'
import { INITIAL_INVITE_STATE } from './invite/types'
import { INITIAL_MEMBERSHIP_STATE } from './membership/types'
import { INITIAL_NOTIFICATION_STATE } from './notification/types'
import { INITIAL_ORDER_STATE } from './order/types'
import { INITIAL_ORG_STATE } from './org/types'
import { INITIAL_PRODUCT_STATE } from './product/types'
import { INITIAL_PROFESSIONAL_STATE } from './professional/types'
import { INITIAL_SERVICE_STATE } from './service/types'
import { INITIAL_SUBSCRIPTION_PLAN_STATE } from './subscription-plan/types'
import { INITIAL_SUBSCRIPTION_STATE } from './subscription/types'
import { INITIAL_UNIT_STATE } from './unit/types'

// Todo aggregate com `INITIAL_*_STATE` — o snapshot persistido. ES-core
// (order/commission/charge/cash-movement/subscription/appointment) + CRUD
// snapshot-on-use. O invariante "PII fora do snapshot" do ADR 0010 vale pros
// dois lados, então auditamos TODOS.
// `INITIAL_ORDER_STATE.items` é `[]` — o seed vazio não expõe o shape do
// `OrderItem`, então auditamos um item representativo explicitamente. Construído
// a partir do tipo: se um dev adicionar PII ao `OrderItem`, o `satisfies` força
// preencher o campo aqui e a auditoria pega. `name` = label do catálogo (não
// pessoa) — allowlistado em `order-item.name`.
const SAMPLE_ORDER_ITEM = {
  id: '',
  kind: 'service',
  refId: '',
  name: '',
  quantity: 1,
  unitPriceCents: 0,
  commission: null,
  attributedUserId: '',
  coverage: 'sale',
  subscriptionId: null,
} satisfies OrderItem

const SNAPSHOTS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['order', INITIAL_ORDER_STATE],
  ['order-item', SAMPLE_ORDER_ITEM],
  ['commission', INITIAL_COMMISSION_STATE],
  ['charge', INITIAL_CHARGE_STATE],
  ['cash-movement', INITIAL_CASH_MOVEMENT_STATE],
  ['subscription', INITIAL_SUBSCRIPTION_STATE],
  ['appointment', INITIAL_APPOINTMENT_STATE],
  ['agenda-block', INITIAL_AGENDA_BLOCK_STATE],
  ['catalog-item', INITIAL_CATALOG_ITEM_STATE],
  ['category', INITIAL_CATEGORY_STATE],
  ['product', INITIAL_PRODUCT_STATE],
  ['service', INITIAL_SERVICE_STATE],
  ['subscription-plan', INITIAL_SUBSCRIPTION_PLAN_STATE],
  ['professional', INITIAL_PROFESSIONAL_STATE],
  ['unit', INITIAL_UNIT_STATE],
  ['org', INITIAL_ORG_STATE],
  ['customer', INITIAL_CUSTOMER_STATE],
  ['membership', INITIAL_MEMBERSHIP_STATE],
  ['invite', INITIAL_INVITE_STATE],
  ['notification', INITIAL_NOTIFICATION_STATE],
]

// Tokens de PII de TITULAR (pessoa física). Casados como palavra-inteira contra
// o nome do campo (lowercased). Um campo que case = vazamento de PII no snapshot.
// `name` cru entra aqui — nome de pessoa nunca pode viver num snapshot; nomes de
// negócio/plano/catálogo são permitidos via ALLOWLIST documentada abaixo.
const PII_TOKENS = [
  'name',
  'fullname',
  'firstname',
  'lastname',
  'displayname',
  'whatsapp',
  'phone',
  'mobile',
  'email',
  'cpf',
  'cnpj',
  'taxid',
  'taxidentity',
  'birthdate',
  'birthday',
  'dateofbirth',
  'address',
  'street',
  'zipcode',
  'postalcode',
  'rg',
  'passport',
] as const

// Campos `name` que NÃO são PII de titular — rótulo de NEGÓCIO/PLANO/CATÁLOGO,
// não de pessoa. Documentado por path (`<aggregate>.<...path>`). Qualquer `name`
// novo fora desta lista falha — o dev decide conscientemente se é PII ou label.
const ALLOWED_NAME_PATHS = new Set<string>([
  // Nome do estabelecimento (não titular) — `units_pii` é contato da unidade.
  'unit.name',
  // Nome do negócio do org (não titular) — taxIdentity (PII do dono) vive
  // em doc apagável, fora do snapshot (StoredOrg = Omit<Org,'taxIdentity'>).
  'org.name',
  // Rótulo do item de catálogo (serviço/produto) — não é pessoa.
  'catalog-item.name',
  'category.name',
  'product.name',
  'service.name',
  'subscription-plan.name',
  // Snapshot do plano dentro da assinatura — nome do PLANO, não do titular.
  'subscription.plan.name',
  // Label do item de catálogo snapshotado na comissão (brief 0030: `itemName` +
  // `attributedUserId`, ref de membro, SEM nome de pessoa). Idem `OrderItem.name`.
  'commission.itemName',
  // EXCEÇÃO DELIBERADA E ESTREITA (brief 0041 AC-11): o nome identificável do
  // PROFISSIONAL snapshotado na comissão. Diferente de todo outro `name` desta
  // lista (que são rótulos de negócio/catálogo), ESTE É nome de pessoa — e é
  // intencional. O registro de comissão é um registro de RETENÇÃO DE VÍNCULO
  // (quem foi pago; art. 16 — deve permanecer identificável), legalmente
  // DISTINTO do contrato D2 do ADR 0010 ("PII fora de evento"), que governa PII
  // de CLIENTE e o direito à eliminação (LGPD). O join ao vivo
  // (`listOrgMembers`, `status==active`) dropa o membro revogado/anonimizado
  // → relatório mostrava "--"; snapshotar o nome torna o registro self-contained
  // e imune a isso. Exceção restrita a ESTE campo neste aggregate; qualquer
  // outro `name`/PII de titular num snapshot continua falhando o audit.
  'commission.attributedMemberName',
  // Label do item de catálogo na linha da comanda — não é pessoa.
  'order-item.name',
])

// Campos cujo token de PII casa mas que NÃO são PII de titular — dado do
// ESTABELECIMENTO ou config, fora do escopo de titular (LGPD). Documentado por
// `<path>::<token>`. O contato real do estabelecimento (whatsapp/email da unidade)
// vive em `units_pii` apagável; aqui ficam só endereço público da unidade e os
// templates de mensagem do org (config, não número de pessoa).
const ALLOWED_NON_TITULAR_PII = new Set<string>([
  // Endereço público da unidade (estabelecimento), não residência de titular.
  // Model v2 (PRD Identidade): a Unidade é estabelecimento real, localizável —
  // o endereço é EXIBIDO na página pública de agendamento/localização da unidade
  // (dado de NEGÓCIO público, não PII de pessoa física). `address` virou REQUIRED
  // em `StoredUnit` e portanto no evento `unit.created`; o walk recursivo agora
  // desce nos campos do objeto, então cada sub-campo precisa ser allowlistado
  // explicitamente como dado de estabelecimento (não titular).
  'unit.address::address',
  'unit.address.postalCode::postalcode',
  'unit.address.street::street',
  // Templates de mensagem WhatsApp do org (config) — o NÚMERO vive em units_pii.
  'org.whatsappTemplates::whatsapp',
])

// Walk recursivo: coleta `<path>` de toda chave do snapshot, descendo em objetos
// aninhados (ex.: `subscription.plan`, `appointment.commissionSnapshot`). Arrays
// vazios no seed não têm shape de elemento — cobertos pela tipagem
// `Partial<XState>` no reducer + os replay tests por-aggregate.
function collectFieldPaths(value: unknown, prefix: string, out: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (key === '_version') continue
    const path = prefix ? `${prefix}.${key}` : key
    out.push(path)
    collectFieldPaths(child, path, out)
  }
}

// Casa um token de PII como palavra-inteira dentro do nome do campo, lidando com
// camelCase (`birthDate` → `birth`, `date`) e o token colado (`birthdate`).
function fieldMatchesPiiToken(fieldName: string, token: string): boolean {
  const lower = fieldName.toLowerCase()
  if (lower === token) return true
  // camelCase boundary: token aparece como segmento (ex.: `customerName`,
  // `taxIdentity`). Quebra o nome em segmentos por maiúscula e compara.
  const segments = fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return segments.includes(token)
}

describe('AC-05 — zero PII in event snapshots/payloads (ADR 0010 invariant)', () => {
  it('enumerates every event-sourced aggregate (no aggregate silently skipped)', () => {
    // Guarda contra um aggregate novo nascer sem entrar na auditoria: 19
    // `INITIAL_*_STATE` exportados + o `OrderItem` aninhado auditado à parte.
    expect(SNAPSHOTS.length).toBe(20)
    const labels = SNAPSHOTS.map(([label]) => label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  for (const [aggregate, snapshot] of SNAPSHOTS) {
    it(`${aggregate} snapshot carries no titular PII — identity by reference only`, () => {
      const paths: string[] = []
      collectFieldPaths(snapshot, aggregate, paths)

      const leaks: string[] = []
      for (const path of paths) {
        const fieldName = path.slice(path.lastIndexOf('.') + 1)
        for (const token of PII_TOKENS) {
          if (!fieldMatchesPiiToken(fieldName, token)) continue
          // `name` é o token com exceção de label de negócio/plano/catálogo.
          if (token === 'name' && ALLOWED_NAME_PATHS.has(path)) continue
          // Dado de estabelecimento/config (endereço da unidade, templates do
          // org) — fora do escopo de titular.
          if (ALLOWED_NON_TITULAR_PII.has(`${path}::${token}`)) continue
          leaks.push(`${path} (matched PII token "${token}")`)
        }
      }

      expect(
        leaks,
        `PII leak in "${aggregate}" snapshot — move identity to a reference (id) ` +
          `and keep the value in a deletable _pii/global doc. Leaks:\n  ${leaks.join('\n  ')}`,
      ).toEqual([])
    })
  }

  it('the denylist actually fires (meta-test — guards a no-op gate)', () => {
    // Prova que o matcher pega PII de fato: um snapshot sintético com `name`/
    // `whatsapp`/`taxIdentity`/`birthDate` aninhado tem que vazar.
    const poisoned = {
      id: '',
      customerId: 'ref-ok',
      attributedUserId: 'ref-ok',
      name: 'Fulano',
      contact: { whatsapp: '+55...', email: 'a@b.c' },
      taxIdentity: { taxId: '000' },
      birthDate: '1990-01-01',
    }
    const paths: string[] = []
    collectFieldPaths(poisoned, 'poisoned', paths)
    const matched = paths.filter((path) => {
      const fieldName = path.slice(path.lastIndexOf('.') + 1)
      return PII_TOKENS.some((token) => fieldMatchesPiiToken(fieldName, token))
    })
    // pega name, whatsapp, email, taxIdentity, taxId, birthDate (6)
    expect(matched.sort()).toEqual(
      [
        'poisoned.birthDate',
        'poisoned.contact.email',
        'poisoned.contact.whatsapp',
        'poisoned.name',
        'poisoned.taxIdentity',
        'poisoned.taxIdentity.taxId',
      ].sort(),
    )
    // FKs não vazam
    expect(matched).not.toContain('poisoned.customerId')
    expect(matched).not.toContain('poisoned.attributedUserId')
  })
})
