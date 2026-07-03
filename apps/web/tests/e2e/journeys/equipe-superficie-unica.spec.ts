// Feature-level E2E — parent #1084 (epic 0037 "Equipe como superfície única").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–4), NOT the granular coverage the sub-issue
// specs already prove exhaustively against the emulator:
//   - team/member-detail.spec.ts            (#1085 · AC-01/02/03 + refino A/B)
//   - team/memberOperations-route-gone.spec.ts (#1085 · AC-01 regression)
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
// Runs against the running emulator (auth only) + Postgres event store. Reads
// the projection + membership straight from Postgres to assert the lifecycle
// invariants.

import {
  defaultPermissionsForRole,
  formatBrazilPhone,
  membershipDocId,
  roleDescription,
} from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import {
  pgReadProjection,
  readMemberOperationByUserId,
  seedAuthUser,
  seedInvite,
  seedMembershipFor,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

test.describe('Equipe como superfície única — DoD (#1084 · 0037)', () => {
  // Cenário 1 — editar profissional pelo /team.
  // A memberOperation member is seeded with a linked User + Membership so the
  // projection ⟺ membership invariant holds and the detail is navigable.
  test.describe('Cenário 1 — editar profissional pelo /team', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('detalhe do membro edita campos operacionais com um Salvar; identidade read-only; /memberOperations não existe', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`
      const pros = new MemberOperationsPage(authedPage)

      // /team is the single people surface — the member row's ⋯ menu → Editar
      // navigates to the detail (no parallel /memberOperations route).
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
      // WhatsApp do pro é gerado único por run (unicidade global) — assert o
      // formato BR-mascarado, não um literal.
      await expect(pros.identityWhatsapp()).toHaveText(/^\(\d{2}\) \d{5}-\d{4}$/)
      await expect(pros.identityEmail()).toContainText('@e2e.local')
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)

      // Edit an operational field (commission + an eligible service) and save
      // with the single Salvar — it persists.
      await seedService(org.orgId, {
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

      // /memberOperations is gone (AC-01): the edit route 404s.
      const res = await authedPage.goto(`/memberOperations/${org.memberOperationIds[0]!}`)
      expect(res?.status()).toBe(404)
    })
  })

  // Cenário 2 — role-edit →memberOperation materializa a projeção.
  test.describe('Cenário 2 — role-edit →memberOperation materializa', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('owner muda receptionist→memberOperation: projeção materializa, permissões re-derivam, operável ao completar', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })

      // No projection before the change.
      expect(await readMemberOperationByUserId(org.orgId, member.uid)).toBeNull()

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Recepção')

      // Change role → memberOperation via the inline select + single Salvar
      // (no separate "Trocar papel" button).
      await chooseOption(authedPage, 'Papel', 'Profissional')
      await pros.saveButton().click()

      // The lifecycle materializes the projection (status `incomplete` — off
      // the public agenda until the profile completes). Poll the Postgres
      // read: the in-page select is optimistic / racy with router.refresh().
      await expect
        .poll(
          async () => (await readMemberOperationByUserId(org.orgId, member.uid))?.operationalStatus,
        )
        .toBe('incomplete')

      // Permissions re-derived to the memberOperation default (AC-06).
      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, member.uid)),
      )
      expect(membership?.role).toBe('member_operator')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('member_operator'))

      // Completing the operational profile (unit + service) makes it operable
      // — the derived status flips to `operational` (bookable on the agenda).
      await seedService(org.orgId, {
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
        .poll(
          async () => (await readMemberOperationByUserId(org.orgId, member.uid))?.operationalStatus,
        )
        .toBe('operational')
    })
  })

  // Cenário 3 — role-edit memberOperation→outro desativa a projeção.
  test.describe('Cenário 3 — role-edit memberOperation→outro desativa', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
      },
    })

    test('owner muda memberOperation→receptionist: projeção desativa (sai da agenda, não deleta); sem órfã operável', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`

      // Operable memberOperation before the change.
      expect((await readMemberOperationByUserId(org.orgId, proUid))?.operationalStatus).toBe(
        'operational',
      )

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      // Demote → receptionist via the inline select + single Salvar.
      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()

      // The memberOperation projection is RETAINED (not deleted, reversible —
      // #1226 AC-02), and `operationalStatus` is derived purely from profile
      // facts so it is NOT mutated by the demotion. Operability is severed
      // because the membership is no longer `memberOperation` — every operational
      // surface keys on the role — so no orphan-operable member survives. Poll
      // the role change (no receptionist-specific UI to anchor on).
      await expect
        .poll(
          async () =>
            (
              await pgReadProjection(
                'memberships',
                aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, proUid)),
              )
            )?.role,
        )
        .toBe('receptionist')
      expect(await readMemberOperationByUserId(org.orgId, proUid)).not.toBeNull()

      // Permissions re-derived to the receptionist default (AC-06).
      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, proUid)),
      )
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })

  // Cenário 4 — hierarquia do /team.
  test.describe('Cenário 4 — hierarquia do /team', () => {
    // Several memberOperations → a non-trivial members list, so "doesn't sink"
    // is meaningful.
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 3 } })

    test('Convidar no topo (não afunda) + filtro Status (Pendentes mostra convite); modal mostra descrição do papel', async ({
      org,
      authedPage,
    }) => {
      const pendingWhatsapp = uniqueWhatsapp()
      const pendingDisplay = formatBrazilPhone(pendingWhatsapp)
      await seedInvite({
        orgId: org.orgId,
        mobile: pendingWhatsapp,
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
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()
      await expect(firstMember).toBeVisible()

      // Narrowing to Pendentes shows the invite and drops the members.
      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()
      await expect(listItem(authedPage, 'Profissional 1')).toHaveCount(0)

      // The invite modal surfaces each role's permission description (refino C).
      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()
      await chooseOption(dialog, 'Papel', 'Profissional')
      await expect(
        dialog.getByRole('note', { name: 'Permissões do papel', exact: true }),
      ).toContainText(roleDescription('member_operator'))
    })
  })

  // Baseline obrigatório (UI/CRUD): render + empty state; owner non-editable.
  test.describe('Baseline — render + empty + owner não-editável', () => {
    // 1 unidade (o piso pós-fluxo-guiado da v2) + 0 profissionais isola o caso
    // "equipe só com o owner" sem disparar o redirect guiado de 0 unidades.
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

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
      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })
})
