// Feature E2E for #1086 (brief 0037 AC-04/AC-05/AC-06): in-place role-edit with
// projection lifecycle. From the member detail at `/team/{userId}`, an owner
// changes a member's role; the Professional projection materializes/deactivates
// in the same flow and permissions re-derive.
//
//   - receptionist → professional: a Professional projection is MATERIALIZED
//     (approval `none`, off the public agenda until the profile completes);
//     completing the operational profile makes it operable.
//   - professional → receptionist: the projection is DEACTIVATED
//     (`professional.suspended` → approval leaves `approved`, off the public
//     agenda); the projection is NOT deleted (AC-05 no orphan operable
//     projection); the membership permissions re-derive to the receptionist
//     default.
//
// Runs against the emulator (no mocks). Reads the projection + membership
// straight from Firestore to assert the invariant.

import { defaultPermissionsForRole, membershipDocId } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { chooseOption } from '../helpers/select'
import {
  readMembership,
  readProfessionalByUserId,
  seedAuthUser,
  seedService,
  type SeededTenant,
} from '../helpers/session'
import { ProfessionalsPage } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// Seeds a receptionist membership (admin bypass) for an existing auth user so
// the member is navigable at `/team/{userId}`. Mirrors the owner membership
// shape. (Local copy — member-detail.spec has the same helper; the E2E suite
// keeps per-spec seeding self-contained.)
function seedReceptionistMembership(tenant: SeededTenant, userId: string): void {
  const now = new Date().toISOString()
  const id = membershipDocId(tenant.tenantId, userId)
  const perms = defaultPermissionsForRole('receptionist')
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
          tenantId: { stringValue: tenant.tenantId },
          userId: { stringValue: userId },
          role: { stringValue: 'receptionist' },
          status: { stringValue: 'active' },
          invitedBy: { stringValue: tenant.uid },
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

test.describe('Equipe — role-edit com lifecycle (#1086)', { tag: '@critical' }, () => {
  test.describe('receptionist → professional materializa a projeção', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 0 } })

    test('troca de papel materializa a projeção (não-operável até o perfil completar)', async ({
      tenant,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      seedReceptionistMembership(tenant, member.uid)

      // No projection before the role change.
      expect(readProfessionalByUserId(tenant.tenantId, member.uid)).toBeNull()

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Recepção')

      // Refino B: change role → professional via the inline select + single
      // Salvar (no separate "Trocar papel" button).
      await chooseOption(authedPage, 'Papel', 'Profissional')
      await pros.saveButton().click()

      // AC-04: the single Salvar runs the lifecycle — the projection is
      // materialized, linked to userId, status `incomplete` (off the public
      // agenda until the profile completes). Poll the Firestore read to wait for
      // the server commit (the in-page select value is optimistic / racy with
      // `router.refresh()`, so it's not the anchor).
      await expect
        .poll(() => readProfessionalByUserId(tenant.tenantId, member.uid)?.operationalStatus)
        .toBe('incomplete')

      // A fresh navigation (clean server render, no optimistic state) reflects
      // the persisted role in the inline select.
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // AC-06: permissions re-derived to the professional default.
      const membership = readMembership(membershipDocId(tenant.tenantId, member.uid))
      expect(membership?.role).toBe('professional')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('professional'))

      // Completing the operational profile (unit + service) makes it operable —
      // derived approval flips to `approved` (becomes bookable on the agenda).
      const svc = seedService(tenant.tenantId, {
        name: 'Corte Operável',
        publicVisible: true,
        unitIds: [tenant.unitIds[0]!],
      })
      await pros.gotoByUserId(member.uid)
      // Operational fields show directly (no Editar gate). Unit checkboxes are
      // labeled by unit name; check the first in the "Unidades" group, then link
      // the eligible service.
      const unitGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await unitGroup.getByRole('checkbox').first().check()
      await authedPage.getByRole('checkbox', { name: 'Corte Operável' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      const afterProfile = readProfessionalByUserId(tenant.tenantId, member.uid)
      expect(afterProfile?.operationalStatus).toBe('operational')
      expect(svc).toBeTruthy()
    })
  })

  test.describe('professional → receptionist desativa a projeção', () => {
    test.use({
      tenantInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
      },
    })

    test('demoção desativa a projeção (sai da agenda) sem deletar; permissões re-derivam', async ({
      tenant,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${tenant.professionalIds[0]!}`

      // Operable professional before the change.
      const before = readProfessionalByUserId(tenant.tenantId, proUid)
      expect(before?.operationalStatus).toBe('operational')

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // Refino B: demote → receptionist via the inline select + single Salvar.
      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()
      // The optimistic select value (and the operational fields hiding) flip
      // before the server commits, so neither is a reliable post-commit anchor.
      // The demotion has no receptionist-specific UI to wait on, so poll the
      // projection read until the suspend lifecycle lands (AC-04/AC-05): the
      // projection is DEACTIVATED (off the agenda), NOT deleted — no orphan
      // operable projection remains.
      await expect
        .poll(() => readProfessionalByUserId(tenant.tenantId, proUid)?.operationalStatus)
        .toBe('incomplete')
      const after = readProfessionalByUserId(tenant.tenantId, proUid)
      expect(after).not.toBeNull()

      // AC-06: permissions re-derived to the receptionist default.
      const membership = readMembership(membershipDocId(tenant.tenantId, proUid))
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })
})
