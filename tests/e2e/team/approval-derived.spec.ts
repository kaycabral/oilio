import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { seedService, uniqueWhatsapp } from '../helpers/session'
import { MemberOperationsPage, PublicBookingPage, orgSlug } from '../pages'

function memberOperatorUserId(memberOperationId: string): string {
  return `e2e-prof-user-${memberOperationId}`
}

async function patchUserMobile(uid: string, mobile: string | null): Promise<void> {
  await patchUser(uid, { mobile, completion_completed: mobile !== null }, new Date().toISOString())
}

test.describe(
  'Professionals — status operacional derivado por evento (#1047)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'incomplete',
      },
    })

    test('não há input de status — o status é texto read-only derivado', async ({
      org,
      authedPage,
    }) => {
      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoById(org.memberOperationIds[0]!)

      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      await expect(authedPage.locator('select[name="operationalStatus"]')).toHaveCount(0)
      await expect(authedPage.locator('[name="operationalStatus"]')).toHaveCount(0)
    })

    test('sem WhatsApp/serviço fica incompleto e não aparece na agenda pública', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!

      await patchUserMobile(memberOperatorUserId(proId), null)

      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('Profissional 1')).toHaveCount(0)
    })

    test('completar o perfil (unidade + serviço + WhatsApp) vira operacional sozinho', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!

      await patchUser(
        memberOperatorUserId(proId),
        { mobile: uniqueWhatsapp() },
        new Date().toISOString(),
      )

      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      await authedPage.getByRole('checkbox', { name: 'Corte' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Operacional')

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('Profissional 1').first()).toBeVisible()
    })
  },
)
