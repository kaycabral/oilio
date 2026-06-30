// Two formalization orgs owned by a SECOND owner, "Ana Fiscal", to exercise the
// PF→PJ fiscal lifecycle (brief 0048) side by side:
//   • an INFORMAL org   — its unit has `fiscal: { kind: 'informal' }` (no CNPJ).
//   • a FORMALIZED org   — its unit carries a `company` UnitFiscal (CNPJ-14 +
//     the public-registry CompanyProfile, NON-PII, in the event payload) PLUS
//     the deletable PII sidecars: `units_pii` (whatsapp) and `unit_tax_identity`
//     (the razão social / nome fantasia, which embed a civil name → PII).
//
// Ana logs in, so a tester can switch owners and see both fiscal states.

import type { TaxIdentity } from '@/domain'
import { upsertUnitsPii, upsertUnitTaxIdentity } from '@/shared/db/pg/units-pii-store'
import {
  buildAddress,
  buildOrg,
  buildUnit,
  companyFiscal,
} from '@/shared/fixtures/seed-domain-builders'
import { ensureAuthIdentity } from './auth'
import { seedOrgWithOwner, seedUnit } from './org-base'
import { now } from './runtime'

const ANA = {
  uid: 'seed-owner-ana',
  email: 'ana.fiscal@cbrl.local',
  displayName: 'Ana Fiscal',
  whatsapp: '5511933330000',
}

const ORG_INFORMAL = 'seed-org-informal'
const ORG_FORMAL = 'seed-org-formal'
const UNIT_INFORMAL = 'seed-unit-informal'
const UNIT_FORMAL = 'seed-unit-formal'

export async function seedFormalizacao(): Promise<void> {
  await ensureAuthIdentity({ uid: ANA.uid, email: ANA.email, displayName: ANA.displayName })

  // — Informal org: unit operates with no fiscal identity —
  await seedOrgWithOwner({
    org: buildOrg(ORG_INFORMAL, ANA.uid, now, {
      name: 'Studio Ana (Informal)',
      slug: 'studio-ana-informal',
      vertical: 'other',
    }),
    owner: ANA,
    now,
  })
  await seedUnit(
    buildUnit(UNIT_INFORMAL, ORG_INFORMAL, now, {
      name: 'Studio',
      slug: UNIT_INFORMAL,
      address: buildAddress({ neighborhood: 'Vila Madalena', street: 'Rua Harmonia' }),
    }),
    ANA.uid,
  )

  // — Formalized org: unit carries a company CNPJ + registry profile —
  await seedOrgWithOwner({
    org: buildOrg(ORG_FORMAL, ANA.uid, now, {
      name: 'Ana Fiscal ME',
      slug: 'ana-fiscal-me',
      vertical: 'other',
    }),
    owner: ANA,
    now,
  })
  await seedUnit(
    buildUnit(UNIT_FORMAL, ORG_FORMAL, now, {
      name: 'Matriz',
      slug: UNIT_FORMAL,
      address: buildAddress({ neighborhood: 'Itaim Bibi', street: 'Rua Joaquim Floriano' }),
      fiscal: companyFiscal('12345678000190', now),
    }),
    ANA.uid,
  )

  // PII sidecars for the formalized unit (deletable, off the event payload).
  await upsertUnitsPii(ORG_FORMAL, UNIT_FORMAL, {
    whatsapp: ANA.whatsapp,
    email: 'contato@anafiscal.com.br',
  })
  const companyTaxIdentity: TaxIdentity = {
    kind: 'company',
    taxId: '12345678000190',
    legalName: 'Ana Fiscal Serviços de Beleza ME',
    tradeName: 'Ana Fiscal',
  }
  await upsertUnitTaxIdentity(ORG_FORMAL, UNIT_FORMAL, companyTaxIdentity)
}
