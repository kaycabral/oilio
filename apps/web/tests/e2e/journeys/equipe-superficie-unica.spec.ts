// Feature-level E2E — parent #1084 (epic 0037 "Equipe como superfície única").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–4), NOT the granular coverage the sub-issue
// specs already prove exhaustively against the emulator:
//   - team/member-detail.spec.ts            (#1085 · AC-01/02/03 + refino A/B)
//   - team/professionals-route-gone.spec.ts (#1085 · AC-01 regression)
//   - team/role-change-lifecycle.spec.ts    (#1086 · AC-04/05/06)
//   - team/team-hierarchy.spec.ts           (#1087 · AC-07 + refino C)
//   - team/{identity,approval,invite-to-materialized}.spec.ts (0028 base)
//
// Here we re-assert the SAME invariants stitched into the one journey the owner
// lives, driving the FINAL UX after the 2026-06-02 refino:
//   - single Salvar (no "Editar" gate, no separate "Trocar papel" button);
//   - the role <select> replaces the static "Papel" label (in the info box);
//   - the owner is non-editable (no link, read-only detail);
//   - the invite modal shows each role's permission description.
//
// Runs against the running emulator (no mocks). Reads the projection +
// membership straight from Firestore to assert the lifecycle invariants.

import { defaultPermissionsForRole, membershipDocId, roleDescription } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { listItem, rowAction } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import {
  readMembership,
  readProfessionalByUserId,
  seedAuthUser,
  seedInvite,
  seedService,
  type SeededOrg,
} from '../helpers/session'
import { ProfessionalsPage } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Seeds a non-professional membership (admin bypass) for an existing auth user
// so the member shows up in `/team` and its detail is navigable at
// `/team/{userId}`. Mirrors the owner-membership shape; permissions come from
// the canonical default so the spec asserts the SAME source the app re-derives.
function seedMembership(org: SeededOrg, userId: string, role: 'manager' | 'receptionist'): void {
  const now = new Date().toISOString()
  const id = membershipDocId(org.orgId, userId)
  const perms = defaultPermissionsForRole(role)
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
              fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, boolValue(v)])),
            },
          },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

test.describe('Equipe como superfície única — DoD (#1084 · 0037)', () => {
  // Cenário 1 — editar profissional pelo /team.
  // A professional member is seeded with a linked User + Membership so the
  // projection ⟺ membership invariant holds and the detail is navigable.
  test.describe('Cenário 1 — editar profissional pelo /team', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('detalhe do membro edita campos operacionais com um Salvar; identidade read-only; /professionals não existe', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`
      const pros = new ProfessionalsPage(authedPage)

      // /team is the single people surface — the member row's ⋯ menu → Editar
      // navigates to the detail (no parallel /professionals route).
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await rowAction(authedPage, 'Profissional 1', 'Editar')
      await expect(authedPage).toHaveURL(new RegExp(`/team/${proUid}$`))

      // Final UX: no "Editar" gate — the role select + operational fields
      // show directly; one Salvar. Role lives in the inline select.
      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // Operational fields are visible without any reveal step.
      await expect(
        authedPage.getByRole('group', { name: 'Comissão padrão', exact: true }),
      ).toBeVisible()
      await expect(authedPage.getByRole('group', { name: 'Unidades', exact: true })).toBeVisible()

      // Personal identity (name/whatsapp/email) is read-only at the top, from
      // the linked User — never repeated as editable inputs in the form.
      await expect(pros.identityName()).toHaveText('Profissional 1')
      await expect(pros.identityWhatsapp()).toHaveText('(11) 90000-0000')
      await expect(pros.identityEmail()).toContainText('@e2e.local')
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)

      // Edit an operational field (commission + an eligible service) and save
      // with the single Salvar — it persists.
      seedService(org.orgId, {
        name: 'Corte Jornada',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await pros.gotoByUserId(proUid)
      await authedPage.getByRole('radio', { name: /percentual/i }).check()
      await authedPage.locator('input[name="commissionValue"]').fill('35')
      await authedPage.getByRole('checkbox', { name: 'Corte Jornada' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await pros.gotoByUserId(proUid)
      await expect(authedPage.locator('input[name="commissionValue"]')).toHaveValue('35')

      // /professionals is gone (AC-01): the edit route 404s.
      const res = await authedPage.goto(`/professionals/${org.professionalIds[0]!}`)
      expect(res?.status()).toBe(404)
    })
  })

  // Cenário 2 — role-edit →professional materializa a projeção.
  test.describe('Cenário 2 — role-edit →professional materializa', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

    test('owner muda receptionist→professional: projeção materializa, permissões re-derivam, operável ao completar', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      seedMembership(org, member.uid, 'receptionist')

      // No projection before the change.
      expect(readProfessionalByUserId(org.orgId, member.uid)).toBeNull()

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Recepção')

      // Change role → professional via the inline select + single Salvar
      // (no separate "Trocar papel" button).
      await chooseOption(authedPage, 'Papel', 'Profissional')
      await pros.saveButton().click()

      // The lifecycle materializes the projection (status `incomplete` — off
      // the public agenda until the profile completes). Poll the Firestore
      // read: the in-page select is optimistic / racy with router.refresh().
      await expect
        .poll(() => readProfessionalByUserId(org.orgId, member.uid)?.operationalStatus)
        .toBe('incomplete')

      // Permissions re-derived to the professional default (AC-06).
      const membership = readMembership(membershipDocId(org.orgId, member.uid))
      expect(membership?.role).toBe('professional')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('professional'))

      // Completing the operational profile (unit + service) makes it operable
      // — the derived status flips to `operational` (bookable on the agenda).
      seedService(org.orgId, {
        name: 'Corte Materializado',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await pros.gotoByUserId(member.uid)
      const unitGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await unitGroup.getByRole('checkbox').first().check()
      await authedPage.getByRole('checkbox', { name: 'Corte Materializado' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await expect
        .poll(() => readProfessionalByUserId(org.orgId, member.uid)?.operationalStatus)
        .toBe('operational')
    })
  })

  // Cenário 3 — role-edit professional→outro desativa a projeção.
  test.describe('Cenário 3 — role-edit professional→outro desativa', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
      },
    })

    test('owner muda professional→receptionist: projeção desativa (sai da agenda, não deleta); sem órfã operável', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`

      // Operable professional before the change.
      expect(readProfessionalByUserId(org.orgId, proUid)?.operationalStatus).toBe('operational')

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // Demote → receptionist via the inline select + single Salvar.
      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()

      // The projection is DEACTIVATED (off the agenda), NOT deleted — no
      // orphan operable projection remains (AC-05). Poll the read until the
      // suspend lifecycle lands (the demotion has no receptionist-specific UI
      // to anchor on).
      await expect
        .poll(() => readProfessionalByUserId(org.orgId, proUid)?.operationalStatus)
        .toBe('incomplete')
      expect(readProfessionalByUserId(org.orgId, proUid)).not.toBeNull()

      // Permissions re-derived to the receptionist default (AC-06).
      const membership = readMembership(membershipDocId(org.orgId, proUid))
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })

  // Cenário 4 — hierarquia do /team.
  test.describe('Cenário 4 — hierarquia do /team', () => {
    // Several professionals → a non-trivial members list, so "doesn't sink"
    // is meaningful.
    test.use({ orgInput: { unitCount: 1, professionalCount: 3 } })

    test('Convidar no topo (não afunda) + filtro Status (Pendentes mostra convite); modal mostra descrição do papel', async ({
      org,
      authedPage,
    }) => {
      const pendingEmail = `pending-${Date.now()}@e2e.local`
      seedInvite({
        orgId: org.orgId,
        email: pendingEmail,
        role: 'receptionist',
        invitedBy: org.uid,
      })

      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      // Convidar is a top-of-page primary action and does NOT sink below the
      // members list, regardless of member count.
      const convidar = authedPage.getByRole('button', { name: 'Convidar' })
      const firstMember = listItem(authedPage, 'Profissional 1')
      await expect(convidar).toBeVisible()
      await expect(firstMember).toBeVisible()
      const convidarBox = await convidar.boundingBox()
      const memberBox = await firstMember.boundingBox()
      expect(convidarBox).not.toBeNull()
      expect(memberBox).not.toBeNull()
      expect(convidarBox!.y).toBeLessThan(memberBox!.y)

      // Single flat List + a Status filter (Todos/Ativos/Pendentes) replaces the
      // old Membros/Convites tabs. At rest (Todos) members and the pending
      // invite show together.
      await expect(authedPage.getByText(pendingEmail)).toBeVisible()
      await expect(firstMember).toBeVisible()

      // Narrowing to Pendentes shows the invite and drops the members.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText(pendingEmail)).toBeVisible()
      await expect(listItem(authedPage, 'Profissional 1')).toHaveCount(0)

      // The invite modal surfaces each role's permission description (refino C).
      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()
      await chooseOption(dialog, 'Papel', 'Profissional')
      await expect(
        dialog.getByRole('note', { name: 'Permissões do papel', exact: true }),
      ).toContainText(roleDescription('professional'))
    })
  })

  // Baseline obrigatório (UI/CRUD): render + empty state; owner non-editable.
  test.describe('Baseline — render + empty + owner não-editável', () => {
    test.use({ orgInput: { unitCount: 0, professionalCount: 0 } })

    test('/team abre só com owner; owner não é link e seu detalhe é read-only', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Convidar' })).toBeVisible()

      // Owner row exists but carries NO ⋯ actions menu (no edit affordance) —
      // refino A. The row is a plain `listitem`, never a link.
      const ownerRow = listItem(authedPage, '(você)')
      await expect(ownerRow).toBeVisible()
      await expect(ownerRow.getByRole('button', { name: /^Ações\b/ })).toHaveCount(0)

      // Narrowing the Status filter to Pendentes yields the empty state.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText('Nenhum convite pendente.')).toBeVisible()

      // Owner detail opens read-only: static "Papel", no role select, no Salvar.
      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })
})
