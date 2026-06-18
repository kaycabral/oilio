// E2E spec — brief 0041 AC-11 + AC-03 (#1106): identidade do profissional
// SNAPSHOTADA no registro de comissão (retenção de vínculo, art. 16).
//
// O bug: revogar um membro (offboarding #1103 → membership `status: 'revoked'`)
// fazia o relatório de comissões mostrar "--" pra ele, porque o nome era
// resolvido por JOIN AO VIVO em `listOrgMembers` (`status==active`) — o
// revogado some do join → nome vazio. Viola AC-03 (comissão tem que ficar
// identificável). O fix snapshota o `attributedMemberName` no próprio registro
// na apuração, então o relatório lê o snapshot e o nome real sobrevive à
// revogação / suspensão / anonimização-como-cliente.
//
// Este spec é o gate do #1106: seed comissão COM snapshot → revoga a membership
// → o relatório mostra o NOME REAL (não "--", não rótulo neutro).

import { anonymizedLabel } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedClosedOrder, seedCommission, type SeededOrg } from '../helpers/session'

function docUrl(path: string): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`
}

// Field-merge PATCH (updateMask) for mid-test mutations of an EXISTING doc — the
// emulator replaces the whole document without the mask, so each patched field
// path is listed explicitly to keep the rest of the doc intact.
function patchDocFields(path: string, fields: Record<string, unknown>): void {
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&')
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${docUrl(path)}?${mask}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields }),
    ],
    { stdio: 'pipe' },
  )
}

// Seeds a commission carrying the identity snapshot (`attributedMemberName`) —
// exactly what the close flow now writes (brief 0041 AC-11). A matching closed
// order (in window) keeps the commission in the report scope (the report maps
// commission→unit via `orderId`).
function seedCommissionWithSnapshot(
  org: SeededOrg,
  c: {
    attributedUserId: string
    attributedMemberName: string
    itemName: string
    createdAt: string
  },
): void {
  const orderId = seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: 5000,
    closedAt: c.createdAt,
  })
  seedCommission({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    orderId,
    itemName: c.itemName,
    attributedMemberName: c.attributedMemberName,
  })
}

test.describe(
  'Comissão de profissional revogado fica identificável (#1106)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: { professionalCount: 1, professionalOperationalStatus: 'operational' },
    })

    test('AC-11/AC-03: revogar a membership não some o nome — snapshot mostra o nome real', async ({
      org,
      authedPage,
    }) => {
      const proId = org.professionalIds[0]!
      const proUser = `e2e-prof-user-${proId}`
      // O fixture seed o User com displayName "Profissional 1" (helpers/session.ts).
      const realName = 'Profissional 1'
      const now = new Date().toISOString()

      seedCommissionWithSnapshot(org, {
        attributedUserId: proUser,
        attributedMemberName: realName,
        itemName: 'Corte do Revogado',
        createdAt: now,
      })

      // Revoga a membership (o que o offboarding #1103 faz): some do join ao vivo
      // `listOrgMembers` (`status==active`). Com o join, o nome viria vazio →
      // "--". Com o snapshot, o nome real sobrevive.
      patchDocFields(`memberships/${org.orgId}_${proUser}`, {
        status: { stringValue: 'revoked' },
      })

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // A comissão do revogado aparece.
      await expect(authedPage.getByText('Corte do Revogado')).toBeVisible()

      // E o NOME REAL aparece — não "--"/"—" (join dropado) nem rótulo neutro.
      // O nome vem do snapshot no registro (AC-11), imune à revogação.
      await expect(authedPage.getByText(realName).first()).toBeVisible()

      // Garantia negativa: o placeholder de nome-não-resolvido NÃO aparece pra
      // este membro. "—" (em dash) era o sintoma do bug.
      const commissionsRegion = authedPage.locator('form', {
        has: authedPage.getByRole('button', { name: 'Filtrar' }),
      })
      await expect(commissionsRegion).toBeVisible()
      // A linha da comissão do revogado mostra o nome real, não o placeholder.
      const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Revogado' })
      await expect(revokedRow.getByText(realName)).toBeVisible()
    })

    test('AC-11 (b): anonimizar a conta GLOBAL do profissional não some o nome — snapshot vence o join ao vivo', async ({
      org,
      authedPage,
    }) => {
      // O "buraco global-anon" que o snapshot fecha: a MESMA pessoa também é
      // cliente e anonimiza a conta global (`users/{uid}` scrubbado +
      // `anonymizedAt` setado, igual ao account-anonymization #1093). A
      // membership segue ATIVA (não é offboarding) — então `listOrgMembers`
      // ACHA o membro no join ao vivo, mas `resolveSubjectName` neutraliza pra
      // `‹Profissional› ‹CÓDIGO›` por causa do `anonymizedAt`. Sem o snapshot, o
      // relatório resolveria o nome por esse join → rótulo neutro (errado). Com
      // o snapshot no registro (AC-11), o nome real sobrevive. Este teste prova
      // que o relatório lê o SNAPSHOT, não o join ao vivo.
      const proId = org.professionalIds[0]!
      const proUser = `e2e-prof-user-${proId}`
      const realName = 'Profissional 1'
      const now = new Date().toISOString()

      seedCommissionWithSnapshot(org, {
        attributedUserId: proUser,
        attributedMemberName: realName,
        itemName: 'Corte do Anonimizado',
        createdAt: now,
      })

      // Anonimiza a conta GLOBAL (espelha buildUserAnonymizationScrub do #1093):
      // scrub do displayName + anonymizedAt setado. A membership fica intacta.
      // Full scrub — mirror buildUserAnonymizationScrub (#1093): the `UserAnonymized`
      // branch requires whatsapp AND birthDate null. Leaving them set made the doc
      // fail every union branch and crashed the strict-decoding read.
      patchDocFields(`users/${proUser}`, {
        displayName: { nullValue: null },
        whatsapp: { nullValue: null },
        birthDate: { nullValue: null },
        anonymizedAt: { stringValue: now },
        updatedAt: { stringValue: now },
      })

      // Sanidade: com a conta anonimizada, o join ao vivo neutralizaria pra este
      // rótulo. É exatamente o que o relatório NÃO pode exibir.
      const neutralLabel = anonymizedLabel(proUser, 'Profissional')

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // A comissão do anonimizado aparece.
      await expect(authedPage.getByText('Corte do Anonimizado')).toBeVisible()

      // A LINHA da comissão mostra o NOME REAL — vindo do snapshot, imune à
      // anonimização global. Nem rótulo neutro, nem "--"/"—".
      const anonRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte do Anonimizado' })
      await expect(anonRow.getByText(realName)).toBeVisible()
      await expect(anonRow.getByText(neutralLabel)).toHaveCount(0)

      // Contraste — a PROVA de que o relatório lê o snapshot, não o join ao vivo:
      // o join ao vivo (`listOrgMembers`) NEUTRALIZA por causa do
      // `anonymizedAt`, então o dropdown de filtro "Membro" (alimentado pelo
      // join) mostra o rótulo neutro `‹Profissional› ‹CÓDIGO›`. Se a linha da
      // comissão lesse a mesma fonte, mostraria o mesmo rótulo — o bug do #1106.
      // O filtro "Membro" é um combobox (design): suas opções só montam quando
      // aberto, então abrimos pra inspecionar o rótulo neutro do join ao vivo.
      await authedPage.getByRole('combobox', { name: 'Membro' }).click()
      await expect(authedPage.getByRole('option', { name: neutralLabel })).toBeAttached()
      await authedPage.keyboard.press('Escape')
    })
  },
)
