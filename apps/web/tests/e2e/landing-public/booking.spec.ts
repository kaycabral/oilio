import { StoredOrg, type OrgBranding } from '@/domain/types/org'
import {
  ORG_COLUMNS,
  orgColumnValues,
  rowToDoc as orgRowToDoc,
  PUBLIC_DIRECTORY_UPSERT,
  publicOrgDirectoryValues,
  type OrgRow,
} from '@/shared/db/pg/effect/org-projector'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { orgSlug, PublicBookingPage } from '../pages'

const decodeOrg = Schema.decodeUnknownSync(StoredOrg)

async function patchOrgBranding(
  orgId: string,
  branding: { logoUrl?: string; bannerUrl?: string; description?: string },
): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query<OrgRow>('SELECT * FROM orgs WHERE org_id = $1 AND id = $2', [
      orgId,
      orgId,
    ])
    const row = cur.rows[0]
    if (!row) throw new Error(`patchOrgBranding: org ${orgId} not found`)
    const current = decodeOrg(orgRowToDoc(row))
    const nextBranding: OrgBranding = {
      logoUrl: branding.logoUrl ?? current.branding.logoUrl,
      bannerUrl: branding.bannerUrl ?? current.branding.bannerUrl,
      description: branding.description ?? current.branding.description,
    }
    const updatedAt = new Date().toISOString()
    const next: StoredOrg = { ...current, branding: nextBranding, updatedAt }
    const nextVersion = Number(row.last_event_version) + 1

    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'orgs',
        orgId,
        nextVersion,
        orgId,
        {
          _tag: 'org.updated',
          version: nextVersion,
          timestamp: updatedAt,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: next },
        },
      ],
    )

    const values = orgColumnValues(next, nextVersion)
    const assignments = ORG_COLUMNS.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const placeholders = ORG_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO orgs (${ORG_COLUMNS.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (org_id) DO UPDATE SET ${assignments}`,
      [...values],
    )

    await client.query(PUBLIC_DIRECTORY_UPSERT, publicOrgDirectoryValues(next))
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

test.describe('Landing pública — branding + catálogo + agendamento', () => {
  test.describe('empresa com unidade + profissional', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test(
      'renderiza branding + catálogo público e completa booking',
      { tag: '@critical' },
      async ({ org, authedPage: page }) => {
        const slug = orgSlug(org.orgId)

        await patchOrgBranding(org.orgId, {
          logoUrl: 'https://example.com/logo.png',
          bannerUrl: 'https://example.com/banner.png',
          description: 'Test studio descrição pública.',
        })

        const serviceId = await seedService(org.orgId, {
          name: 'Corte Premium',
          durationMinutes: 30,
          priceCents: 6500,
          publicVisible: true,
          unitIds: org.unitIds,
        })
        await seedService(org.orgId, {
          name: 'Serviço Interno',
          durationMinutes: 30,
          priceCents: 4500,
          publicVisible: false,
          unitIds: org.unitIds,
        })
        await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

        const booking = new PublicBookingPage(page, slug)

        await booking.gotoCatalog()
        await expect(booking.orgHeading()).toBeVisible()
        await expect(page.getByText('Test studio descrição pública.')).toBeVisible()
        await expect(booking.serviceCard('Corte Premium')).toBeVisible()
        await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
        await expect(page.getByText('Serviço Interno')).toHaveCount(0)

        await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
        await booking
          .slotByMemberOperation(/profissional 1/i)
          .first()
          .click()
        await booking.confirmButton().click()
        await expect(booking.successHeading()).toBeVisible()
      },
    )
  })

  test('slug inexistente retorna 404', async ({ page }) => {
    const res = await page.goto('/nao-existe-este-org-xyz-123')
    expect(res?.status()).toBe(404)
  })
})
