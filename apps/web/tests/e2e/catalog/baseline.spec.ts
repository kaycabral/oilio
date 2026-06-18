// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md) para o
// modelo CatalogItem unificado (brief 0023, #1002).
//
// COBERTURA: este slice ADICIONA o modelo unificado + coleção `catalog_items`
// + rules + server actions, mas a UI de CRUD do catálogo unificado é #1005
// (os fluxos visuais hoje vivem em /services e /products). Portanto, em vez de
// dirigir uma UI inexistente, este baseline exercita o caminho fim-a-fim que já
// existe: a coleção `catalog_items` sob as Firestore Rules. Seed (admin) de
// ambos os kinds + 1 degenerado → leitura sob a sessão autenticada do membro
// (rule `allow read: if isMember`) → asserção da projeção campo a campo. O
// CRUD via server actions é provado pelo teste de replay do aggregate
// (`packages/oilio/shared/.../catalog-item-replay.test.ts`) e pelo unit
// das próprias actions. O CRUD visual entra no E2E de #1005.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsValue } from '../helpers/firestore-rest'
import {
  FsValueSchema,
  intStrField,
  isNullField,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import { assertOk } from '../helpers/rules'
import { seedCatalogItem } from '../helpers/session'

const API_KEY = 'fake-api-key'

const decodeIdToken = Schema.decodeUnknownSync(
  Schema.Struct({ idToken: Schema.optional(Schema.String) }),
)
const decodeRequiredFieldsDoc = Schema.decodeUnknownSync(
  Schema.Struct({ fields: Schema.Record({ key: Schema.String, value: FsValueSchema }) }),
)

function fsDocUrl(orgId: string, id: string): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/organizations/${orgId}/catalog_items/${id}`
}

// Mints an idToken for the seeded owner so we can hit Firestore REST *under the
// security rules* (Bearer <idToken>), proving the `catalog_items` read gate.
function ownerIdToken(email: string, password = 'E2E12345!'): string {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'POST',
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ email, password, returnSecureToken: true }),
    ],
    { encoding: 'utf8' },
  )
  const token = parseJson(out, decodeIdToken).idToken
  if (!token) throw new Error('No idToken from auth emulator')
  return token
}

function readUnderRules(
  orgId: string,
  id: string,
  idToken: string,
): { ok: true; fields: Record<string, FsValue> } | { ok: false; status: number } {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', fsDocUrl(orgId, id), '-H', `Authorization: Bearer ${idToken}`],
      { encoding: 'utf8' },
    )
    return { ok: true, fields: parseJson(out, decodeRequiredFieldsDoc).fields }
  } catch {
    return { ok: false, status: 403 }
  }
}

test.describe('CatalogItem — baseline (#1002)', () => {
  test('coleção vazia: leitura sob rules não falha', ({ org }) => {
    const token = ownerIdToken(org.email)
    const res = readUnderRules(org.orgId, 'inexistente', token)
    // Doc ausente → 404 (curl -f). O ponto é que a rule não bloqueia o membro.
    expect(res.ok).toBe(false)
  })

  test('cria (seed) → lê sob rules → ambos os kinds projetam', ({ org }) => {
    const token = ownerIdToken(org.email)

    const serviceId = seedCatalogItem(org.orgId, {
      kind: 'service',
      name: 'Corte Baseline',
      categoryId: 'cat-corte',
      priceCents: 5000,
      durationMinutes: 30,
      unitIds: org.unitIds,
      commission: { kind: 'percentage', value: 50 },
    })
    const productId = seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Pomada Baseline',
      categoryId: 'cat-pomada',
      priceCents: 3000,
      sku: 'POM-1',
      stock: 10,
      unitIds: org.unitIds,
    })

    const svc = readUnderRules(org.orgId, serviceId, token)
    assertOk(svc)
    expect(strField(svc.fields, 'kind')).toBe('service')
    expect(strField(svc.fields, 'name')).toBe('Corte Baseline')
    expect(intStrField(svc.fields, 'durationMinutes')).toBe('30')

    const prod = readUnderRules(org.orgId, productId, token)
    assertOk(prod)
    expect(strField(prod.fields, 'kind')).toBe('product')
    expect(strField(prod.fields, 'sku')).toBe('POM-1')
    expect(intStrField(prod.fields, 'stock')).toBe('10')
  })

  test('dado degenerado (produto sem categoria e sem comissão) projeta', ({ org }) => {
    const token = ownerIdToken(org.email)
    const id = seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Item Degenerado',
      categoryId: null,
      commission: null,
      priceCents: 0,
      stock: 0,
      sku: null,
      unitIds: org.unitIds,
      active: false,
    })
    const res = readUnderRules(org.orgId, id, token)
    assertOk(res)
    expect(isNullField(res.fields, 'categoryId')).toBe(true)
    expect(isNullField(res.fields, 'commission')).toBe(true)
    expect(strField(res.fields, 'kind')).toBe('product')
  })
})
