// Feature E2E for #1085 (brief 0037 AC-01/AC-02/AC-03) + refino review
// 2026-06-02: `/team` is the single people surface. Clicking a member opens the
// member detail; for a `role=professional` member the operational fields
// (units/services/commission/tax) are shown DIRECTLY (no "Editar" gate), with a
// single Salvar. Personal identity (name/whatsapp/email) is read-only at the top
// of the page, sourced live from the linked User (#1046) — never repeated in the
// form. The role <select> replaces the static "Papel" label. A non-professional
// member shows just the role select + Salvar (no operational fields). The owner
// is non-editable (no link, read-only detail).
//
// Runs against the emulator (no mocks). The fixture seeds one professional with
// a linked User (displayName "Profissional 1") AND a Membership(role=professional)
// so the projection ⟺ membership invariant holds and the detail is navigable.

import { membershipDocId } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { listItem, rowAction } from '../helpers/list'
import { seedAuthUser, seedService, type SeededOrg } from '../helpers/session'
import { ProfessionalsPage } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Seeds a non-professional membership (admin bypass) for an existing auth user,
// so the member shows up in `/team` and its detail is navigable. Mirrors the
// shape `seedOrg` writes for the owner membership.
function seedMembership(org: SeededOrg, userId: string, role: 'manager' | 'receptionist'): void {
  const now = new Date().toISOString()
  const id = membershipDocId(org.orgId, userId)
  const boolValue = (b: boolean) => ({ booleanValue: b })
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/memberships/${id}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          id: { stringValue: id },
          orgId: { stringValue: org.orgId },
          userId: { stringValue: userId },
          role: { stringValue: role },
          status: { stringValue: 'active' },
          invitedBy: { stringValue: org.uid },
          joinedAt: { stringValue: now },
          updatedAt: { stringValue: now },
          unitId: { nullValue: null },
          commissionRate: { nullValue: null },
          permissions: {
            mapValue: {
              fields: {
                canHaveAgenda: boolValue(false),
                canManageOwnAgenda: boolValue(false),
                canCreateAppointment: boolValue(role === 'receptionist'),
                canCancelAppointment: boolValue(role === 'receptionist'),
                canManageCustomers: boolValue(true),
                canManageServices: boolValue(role === 'manager'),
                canManageProfessionals: boolValue(role === 'manager'),
                canViewFinancials: boolValue(role === 'manager'),
                canManagePlans: boolValue(role === 'manager'),
                canManageSubscriptions: boolValue(role === 'manager'),
              },
            },
          },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

test.describe('Equipe — detalhe do membro (#1085)', { tag: '@critical' }, () => {
  test.describe('membro profissional', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('lista leva ao detalhe; profissional mostra campos operacionais direto (sem Editar); identidade read-only no topo', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`

      // From `/team`, the member row's ⋯ menu → Editar navigates to the detail.
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await rowAction(authedPage, 'Profissional 1', 'Editar')
      await expect(authedPage).toHaveURL(new RegExp(`/team/${proUid}$`))

      const pros = new ProfessionalsPage(authedPage)

      // Refino B: no "Editar" gate — the role select + operational fields show
      // directly. Role lives in the inline select (no static "Papel" label).
      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)
      await expect(pros.roleSelect()).toHaveText('Profissional')
      await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
        'Ativo',
      )

      // Operational fields are visible without any reveal step. Scope to the
      // fieldset legends (role=group) — "Unidades" also matches the sidebar nav.
      await expect(
        authedPage.getByRole('group', { name: 'Comissão padrão', exact: true }),
      ).toBeVisible()
      await expect(authedPage.getByRole('group', { name: 'Unidades', exact: true })).toBeVisible()

      // Refino B: identity is read-only at the TOP (header), not repeated in the
      // form. No identity inputs anywhere.
      await expect(pros.identityName()).toHaveText('Profissional 1')
      await expect(pros.identityWhatsapp()).toHaveText('(11) 90000-0000')
      await expect(pros.identityEmail()).toContainText('@e2e.local')
      // Identity is not duplicated inside the operational form: no name/whatsapp/
      // email inputs render anywhere on the page.
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
    })

    test('editar campos operacionais (comissão + serviço) com um Salvar reflete', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`
      // A public service in the pro's unit so it's eligible in the form.
      seedService(org.orgId, {
        name: 'Corte Detalhe',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(proUid)

      // Toggle commission (operational field) + link the eligible service, then
      // the single Salvar.
      await authedPage.getByRole('radio', { name: /percentual/i }).check()
      await authedPage.locator('input[name="commissionValue"]').fill('40')
      await authedPage.getByRole('checkbox', { name: 'Corte Detalhe' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      // Re-open: the commission persisted.
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('radio', { name: /percentual/i })).toBeChecked()
      await expect(authedPage.locator('input[name="commissionValue"]')).toHaveValue('40')
    })
  })

  test.describe('membro não-profissional (AC-03)', () => {
    test('detalhe mostra role select + Salvar, sem campos operacionais nem Editar', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      seedMembership(org, member.uid, 'receptionist')

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(member.uid)

      // Refino B: role lives in the inline select (no static "Papel" label, no
      // "Editar"). Status is read-only context.
      await expect(pros.roleSelect()).toHaveText('Recepção')
      await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
        'Ativo',
      )
      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)

      // No operational fields for a non-professional (AC-03), but Salvar exists
      // (the role can be changed with one Salvar).
      await expect(
        authedPage.getByRole('group', { name: 'Comissão padrão', exact: true }),
      ).toHaveCount(0)
      await expect(pros.saveButton()).toBeVisible()
    })
  })

  test.describe('owner não-editável (refino A)', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('owner não é link na lista e seu detalhe é read-only', async ({ org, authedPage }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      // The owner row exists but carries NO ⋯ actions menu (no edit affordance).
      const ownerRow = listItem(authedPage, '(você)')
      await expect(ownerRow).toBeVisible()
      await expect(ownerRow.getByRole('button', { name: /^Ações\b/ })).toHaveCount(0)

      // The owner detail is read-only: static "Papel" label, no role select, no
      // Salvar.
      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(pros.roleSelect()).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })

  test.describe('baseline — só o owner (#17)', () => {
    test.use({ orgInput: { unitCount: 0, professionalCount: 0 } })

    test('render + detalhe do owner abre read-only, sem campos operacionais', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      // The owner detail opens read-only (refino A): static role, no edit form.
      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(pros.roleSelect()).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })
})
