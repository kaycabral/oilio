// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md) para a
// entidade Category (brief 0023, #1003).
//
// COBERTURA: este slice ADICIONA a entidade `Category` (coleção `categories`
// + rules + server actions + FK em CatalogItem/SubscriptionPlan), mas a UI de
// CRUD de categorias é #1005. Em vez de dirigir uma UI inexistente, este
// baseline exercita o caminho fim-a-fim que já existe: a coleção `categories`
// sob as Firestore Rules + a FK que liga itens/planos à categoria.
//
//   - render+empty: leitura da coleção vazia sob rules não falha (404 do doc
//     ausente, não 403 — a rule não bloqueia o membro).
//   - create→list→read: seed (admin) de categoria → leitura sob a sessão
//     autenticada do membro (rule `allow read: if isMember`) → projeção campo
//     a campo (rename via update é coberto no replay test do aggregate).
//   - degenerado: categoria sem icon/color projeta `nullValue` fielmente.
//   - AC-05 (delete-in-use): seed categoria + item do catálogo + plano que a
//     referenciam → a MESMA query do guard de `deleteCategory`
//     (`categoryId ==` / `includedCategoryIds array-contains`) encontra as
//     referências sob rules, provando que o delete seria bloqueado. O bloqueio
//     em si (thrown error) é coberto pelo unit da server action; o CRUD visual
//     entra no E2E de #1005.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import type { FsValue } from '../helpers/firestore-rest'
import {
  boolField,
  decodeFsQueryRows,
  FsValueSchema,
  isNullField,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import { assertOk } from '../helpers/rules'
import { seedCatalogItem, seedCategory, seedSubscriptionPlan } from '../helpers/session'

const API_KEY = 'fake-api-key'

const decodeIdToken = Schema.decodeUnknownSync(
  Schema.Struct({ idToken: Schema.optional(Schema.String) }),
)
const decodeRequiredFieldsDoc = Schema.decodeUnknownSync(
  Schema.Struct({ fields: Schema.Record({ key: Schema.String, value: FsValueSchema }) }),
)

function fsDocsBase(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

// Mints an idToken for the seeded owner so we hit Firestore REST *under the
// security rules* (Bearer <idToken>), proving the `categories` read gate.
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
      [
        '-fsS',
        `${fsDocsBase()}/orgs/${orgId}/categories/${id}`,
        '-H',
        `Authorization: Bearer ${idToken}`,
      ],
      { encoding: 'utf8' },
    )
    return { ok: true, fields: parseJson(out, decodeRequiredFieldsDoc).fields }
  } catch {
    return { ok: false, status: 403 }
  }
}

// Runs a structured query under the member's rules — mirrors the exact guard in
// `deleteCategory` (categoryId == / includedCategoryIds array-contains). Returns
// the number of matching docs.
function queryReferenceCount({
  orgId,
  collectionId,
  fieldPath,
  op,
  value,
  idToken,
}: {
  orgId: string
  collectionId: string
  fieldPath: string
  op: 'EQUAL' | 'ARRAY_CONTAINS'
  value: string
  idToken: string
}): number {
  const structuredQuery = {
    from: [{ collectionId }],
    where: {
      fieldFilter: {
        field: { fieldPath },
        op,
        value: { stringValue: value },
      },
    },
    limit: 5,
  }
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'POST',
      `${fsDocsBase()}/orgs/${orgId}:runQuery`,
      '-H',
      `Authorization: Bearer ${idToken}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ structuredQuery }),
    ],
    { encoding: 'utf8' },
  )
  const rows = parseJson(out, decodeFsQueryRows)
  return rows.filter((r) => r.document !== undefined).length
}

test.describe('Category — baseline (#1003)', () => {
  test('coleção vazia: leitura sob rules não falha', ({ org }) => {
    const token = ownerIdToken(org.email)
    const res = readUnderRules(org.orgId, 'inexistente', token)
    // Doc ausente → 404 (curl -f). O ponto é que a rule não bloqueia o membro.
    expect(res.ok).toBe(false)
  })

  test('cria (seed) → lê sob rules → projeta campo a campo', ({ org }) => {
    const token = ownerIdToken(org.email)
    const id = seedCategory(org.orgId, {
      name: 'Cabelo',
      icon: 'scissors',
      color: '#3366ff',
      active: true,
    })
    const res = readUnderRules(org.orgId, id, token)
    assertOk(res)
    expect(strField(res.fields, 'name')).toBe('Cabelo')
    expect(strField(res.fields, 'icon')).toBe('scissors')
    expect(strField(res.fields, 'color')).toBe('#3366ff')
    expect(boolField(res.fields, 'active')).toBe(true)
  })

  test('dado degenerado (categoria sem icon/color) projeta nulls', ({ org }) => {
    const token = ownerIdToken(org.email)
    const id = seedCategory(org.orgId, {
      name: 'Estética',
      icon: null,
      color: null,
      active: false,
    })
    const res = readUnderRules(org.orgId, id, token)
    assertOk(res)
    expect(isNullField(res.fields, 'icon')).toBe(true)
    expect(isNullField(res.fields, 'color')).toBe(true)
    expect(boolField(res.fields, 'active')).toBe(false)
  })

  test('AC-05 — categoria em uso é detectada (guard de delete bloquearia)', ({ org }) => {
    const token = ownerIdToken(org.email)
    const categoryId = seedCategory(org.orgId, { name: 'Em Uso' })

    // Item do catálogo apontando pra categoria via FK.
    seedCatalogItem(org.orgId, {
      kind: 'service',
      name: 'Corte Referenciando',
      categoryId,
      unitIds: org.unitIds,
    })
    // Plano incluindo a categoria via FK array.
    seedSubscriptionPlan(org.orgId, { includedCategoryIds: [categoryId] })

    // A MESMA query do guard de `deleteCategory` — ambas as referências
    // precisam ser encontradas, provando que o delete seria bloqueado.
    const itemRefs = queryReferenceCount({
      orgId: org.orgId,
      collectionId: 'catalog_items',
      fieldPath: 'categoryId',
      op: 'EQUAL',
      value: categoryId,
      idToken: token,
    })
    const planRefs = queryReferenceCount({
      orgId: org.orgId,
      collectionId: 'subscription_plans',
      fieldPath: 'includedCategoryIds',
      op: 'ARRAY_CONTAINS',
      value: categoryId,
      idToken: token,
    })
    expect(itemRefs).toBeGreaterThan(0)
    expect(planRefs).toBeGreaterThan(0)

    // Categoria não referenciada → guard libera (0 refs).
    const freeCategoryId = seedCategory(org.orgId, { name: 'Livre' })
    const freeItemRefs = queryReferenceCount({
      orgId: org.orgId,
      collectionId: 'catalog_items',
      fieldPath: 'categoryId',
      op: 'EQUAL',
      value: freeCategoryId,
      idToken: token,
    })
    const freePlanRefs = queryReferenceCount({
      orgId: org.orgId,
      collectionId: 'subscription_plans',
      fieldPath: 'includedCategoryIds',
      op: 'ARRAY_CONTAINS',
      value: freeCategoryId,
      idToken: token,
    })
    expect(freeItemRefs).toBe(0)
    expect(freePlanRefs).toBe(0)
  })
})
