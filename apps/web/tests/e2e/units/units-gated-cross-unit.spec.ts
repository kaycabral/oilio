// E2E spec — sub-issue #1089 do brief 0039 (AC-05).
//
// `/units` (gerir o conjunto de unidades) é gated por `operatesCrossUnit`
// (`canManageTenant(role) && !membership.unitId`), substituindo o antigo
// `owner||manager`. Validamos contra o emulator (sem mocks), variando o
// papel/unitId da membership do owner do fixture via REST admin bypass:
//   - gerente VINCULADO a uma unidade (membership.unitId != null) PERDE acesso
//     → redirect pra /agenda (e não consegue deep-link em /units/new);
//   - dono (sempre tenant-wide) acessa e ainda gere o conjunto — cria 2ª
//     unidade (regressão da definição cross-unit);
//   - gerente tenant-wide (membership.unitId == null) também acessa.
//
// Mirrors o padrão do brief 0029 (journeys/contexto-por-unidade.spec.ts):
// seed via fixture + flip de role/unitId direto no Firestore.

import { membershipDocId } from '@/domain'
import { expect, test } from '../fixtures'
import { oneUnit } from '../helpers/firestore-rest'
import { listItem } from '../helpers/list'
import { setMembershipRole, setMembershipUnitId } from '../helpers/session'

test.describe(
  '`/units` gated by operatesCrossUnit (#1089 · 0039 AC-05)',
  { tag: '@critical' },
  () => {
    // Tenant com 1 unidade basta pra exercer o gate de rota; a regressão de
    // "criar 2ª unidade" parte daí.
    test.use({ tenantInput: { unitCount: 1 } })

    test('gerente vinculado a uma unidade perde acesso a /units (redirect /agenda)', async ({
      authedPage,
      tenant,
    }) => {
      const membershipId = membershipDocId(tenant.tenantId, tenant.uid)
      const [unit1] = oneUnit(tenant.unitIds)
      // Gerente unit-bound: canManageTenant true, mas unitId != null → predicado false.
      setMembershipRole(membershipId, 'manager')
      setMembershipUnitId(membershipId, unit1)

      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      // Não consegue burlar deep-linkando na criação.
      await authedPage.goto('/units/new')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })

    test('dono acessa /units e ainda gere o conjunto — cria 2ª unidade (regressão)', async ({
      authedPage,
    }) => {
      // Fixture já é owner com unitId null → operatesCrossUnit true.
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/units$/)
      await expect(authedPage.getByRole('heading', { name: 'Unidades' })).toBeVisible()

      // Gere o conjunto: cria uma 2ª unidade (mesmo fluxo do slug.spec.ts).
      await authedPage.getByRole('link', { name: 'Nova unidade' }).click()
      await expect(authedPage).toHaveURL(/\/units\/new$/)

      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro Velho')
      await expect(authedPage.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
      await expect(authedPage.getByText(/disponível/i)).toBeVisible()
      await authedPage.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await authedPage.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(authedPage.getByText(/São Paulo\/SP/)).toBeVisible()
      await authedPage.getByRole('textbox', { name: 'Número' }).fill('200')
      await authedPage.getByRole('button', { name: 'Criar' }).click()

      // A 2ª unidade foi criada (definição cross-unit preservada). Com o tenant
      // agora multi-unidade e sem unidade ativa escolhida, o app intersticia em
      // /select-unit — a nova unidade aparece como opção, provando a criação.
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByRole('button', { name: 'Filial Centro Velho' })).toBeVisible()

      // Escolhendo uma unidade entra no app scoped; daí /units lista as duas
      // (gestão do conjunto inteira — cross-unit, não escopa pro seletor).
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/units$/)
      // The migrated `UnitsList` lists units by name (no slug column): both the
      // new "Filial Centro Velho" (slug filial-centro-velho) and the seeded
      // "Unidade 1" appear — proving the cross-unit set management.
      await expect(listItem(authedPage, /Filial Centro Velho/)).toBeVisible()
      await expect(listItem(authedPage, /Unidade 1/)).toBeVisible()
    })

    test('gerente tenant-wide (unitId null) acessa /units', async ({ authedPage, tenant }) => {
      const membershipId = membershipDocId(tenant.tenantId, tenant.uid)
      // Gerente tenant-wide: canManageTenant true e unitId null → predicado true.
      setMembershipRole(membershipId, 'manager')
      setMembershipUnitId(membershipId, null)

      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/units$/)
      await expect(authedPage.getByRole('heading', { name: 'Unidades' })).toBeVisible()
    })
  },
)
