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
// straight from Postgres (post-cutover event store) to assert the invariant.

import { defaultPermissionsForRole, membershipDocId, MembershipPermissions, Role } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import {
  pgReadProjection,
  readProfessionalByUserId,
  seedAuthUser,
  seedMembershipFor,
  seedService,
} from '../helpers/session'
import { ProfessionalsPage } from '../pages'

// Reads the membership projection straight from the Postgres event store (the
// top-level `memberships/{id}` aggregate). Returns the decoded role + the
// permissions map, or null when absent. The `role`/`permissions` columns are
// snake_case-free here (`role` is a CHECK enum, `permissions` is JSONB decoded
// back into the typed `MembershipPermissions` shape).
async function readMembershipProjection(
  orgId: string,
  membershipId: string,
): Promise<{ role: typeof Role.Type; permissions: MembershipPermissions } | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  if (!row) return null
  return {
    role: Schema.decodeUnknownSync(Role)(row.role),
    permissions: Schema.decodeUnknownSync(MembershipPermissions)(row.permissions),
  }
}

test.describe('Equipe — role-edit com lifecycle (#1086)', { tag: '@critical' }, () => {
  test.describe('receptionist → professional materializa a projeção', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

    test('troca de papel materializa a projeção (não-operável até o perfil completar)', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })

      // No projection before the role change.
      expect(await readProfessionalByUserId(org.orgId, member.uid)).toBeNull()

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Recepção')

      // Refino B: change role → professional via the inline select + single
      // Salvar (no separate "Trocar papel" button).
      await chooseOption(authedPage, 'Papel', 'Profissional')
      await pros.saveButton().click()

      // AC-04: the single Salvar runs the lifecycle — the projection is
      // materialized, linked to userId, status `incomplete` (off the public
      // agenda until the profile completes). Poll the projection read to wait for
      // the server commit (the in-page select value is optimistic / racy with
      // `router.refresh()`, so it's not the anchor).
      await expect
        .poll(
          async () => (await readProfessionalByUserId(org.orgId, member.uid))?.operationalStatus,
        )
        .toBe('incomplete')

      // A fresh navigation (clean server render, no optimistic state) reflects
      // the persisted role in the inline select.
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // AC-06: permissions re-derived to the professional default.
      const membership = await readMembershipProjection(
        org.orgId,
        membershipDocId(org.orgId, member.uid),
      )
      expect(membership?.role).toBe('professional')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('professional'))

      // Completing the operational profile (unit + service) makes it operable —
      // derived approval flips to `approved` (becomes bookable on the agenda).
      const svc = await seedService(org.orgId, {
        name: 'Corte Operável',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
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

      const afterProfile = await readProfessionalByUserId(org.orgId, member.uid)
      expect(afterProfile?.operationalStatus).toBe('operational')
      expect(svc).toBeTruthy()
    })
  })

  test.describe('professional → receptionist desativa a projeção', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
      },
    })

    test('demoção desativa a projeção (sai da agenda) sem deletar; permissões re-derivam', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`

      // Operable professional before the change.
      const before = await readProfessionalByUserId(org.orgId, proUid)
      expect(before?.operationalStatus).toBe('operational')

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // Refino B: demote → receptionist via the inline select + single Salvar.
      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()
      // The optimistic select value flips before the server commits, so it is
      // not a reliable post-commit anchor. The demotion has no
      // receptionist-specific UI to wait on, so poll the membership projection
      // until the role change lands. Under #1226 AC-02 the professional
      // projection is RETAINED (not deleted, reversible) — `operationalStatus`
      // is derived purely from profile facts and is NOT mutated by the role
      // change; operability is severed because the membership is no longer
      // `professional` (every operational surface keys on the role), so no
      // orphan-operable member survives. Poll the role, not a status flip.
      await expect
        .poll(
          async () =>
            (await readMembershipProjection(org.orgId, membershipDocId(org.orgId, proUid)))?.role,
        )
        .toBe('receptionist')
      const after = await readProfessionalByUserId(org.orgId, proUid)
      expect(after).not.toBeNull()

      // AC-06: permissions re-derived to the receptionist default.
      const membership = await readMembershipProjection(
        org.orgId,
        membershipDocId(org.orgId, proUid),
      )
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })
})
