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
import { seedService } from '../helpers/session'
import { orgSlug, PublicBookingPage } from '../pages'

// Épico #672 — Landing pública por estabelecimento.
// - #673 slug público resolve para uma página servida sem auth.
// - #674 branding (logo/banner/descrição) aparece quando configurado.
// - #675 catálogo público filtra `publicVisible && active`.
// - #676 booking público cria customer + appointment.

// Branding patch isn't covered by `helpers/session.ts` (one-off shape).
// Post-cutover this re-projects the org under the event store (Postgres): read
// the current projection, merge the branding patch, append the next
// `org.updated` event, and re-write BOTH the org-scoped row AND the public
// directory row (the public landing page reads `public_org_directory`, brief
// 0062 — they must never drift). Keep this here until a second spec needs it.
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

    // Mirror the public fields into the public directory (same tx) — the public
    // landing page reads this row, not the org-scoped projection. Reuse the
    // projector's own upsert + values (single source of truth).
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
      async ({ org, page }) => {
        const slug = orgSlug(org.orgId)

        await patchOrgBranding(org.orgId, {
          logoUrl: 'https://example.com/logo.png',
          bannerUrl: 'https://example.com/banner.png',
          description: 'Test studio descrição pública.',
        })

        // Serviço visível no catálogo público.
        await seedService(org.orgId, {
          name: 'Corte Premium',
          durationMinutes: 30,
          priceCents: 6500,
          publicVisible: true,
          unitIds: org.unitIds,
        })
        // Serviço NÃO público — não deve aparecer no catálogo.
        await seedService(org.orgId, {
          name: 'Serviço Interno',
          durationMinutes: 30,
          priceCents: 4500,
          publicVisible: false,
          unitIds: org.unitIds,
        })

        const booking = new PublicBookingPage(page, slug)

        // Página pública (sem auth).
        await booking.gotoCatalog()
        await expect(booking.orgHeading()).toBeVisible()
        await expect(page.getByText('Test studio descrição pública.')).toBeVisible()
        await expect(booking.serviceCard('Corte Premium')).toBeVisible()
        await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
        // Service NÃO público fica escondido.
        await expect(page.getByText('Serviço Interno')).toHaveCount(0)

        // Legacy single-step form still works (covered separately from the
        // #844 wizard) — navigate directly to the legacy URL.
        await booking.gotoBookLegacy()
        await expect(booking.legacyHeading()).toBeVisible()

        // Escolhe um horário 3 dias no futuro às 14h pra evitar conflict com testes
        // próximos e ficar bem após `Date.now()`.
        const future = new Date(Date.now() + 3 * 24 * 60 * 60_000)
        const yyyy = future.getUTCFullYear()
        const mm = String(future.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(future.getUTCDate()).padStart(2, '0')
        await booking.fillLegacyForm({
          dateTimeIso: `${yyyy}-${mm}-${dd}T14:00`,
          name: 'Joana Cliente',
          whatsapp: `119${Math.floor(10000000 + Math.random() * 89999999)}`,
        })
        await booking.legacySubmit().click()
        await expect(booking.legacySuccessHeading()).toBeVisible()
      },
    )
  })

  test('slug inexistente retorna 404', async ({ page }) => {
    const res = await page.goto('/nao-existe-este-org-xyz-123')
    expect(res?.status()).toBe(404)
  })
})
