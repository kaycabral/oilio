import {
  formatCnpj,
  isCompanyFiscalProfile,
  type CompanySize,
  type Org,
  type TaxRegime,
} from '@/domain'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@cbrl/design'

const REGIME_LABELS: Record<TaxRegime, string> = {
  mei: 'MEI',
  simples_nacional: 'Simples Nacional',
  other: 'Outro',
}

const SIZE_LABELS: Record<CompanySize, string> = {
  micro: 'Microempresa',
  small: 'Pequeno porte',
  other: 'Demais',
}

// Read-only fiscal identity of a FORMALIZED org (brief 0048 AC-08): razão
// social / nome fantasia (from the PII doc, merged at read time) + regime /
// CNAE / porte (from the StoredOrg fiscalProfile). No editable taxId, no
// "optional / CPF-or-CNPJ" affordance — formalization is the only way in, and
// it's immutable once done.
export function FiscalSection({ org }: { org: Org }) {
  const fiscal = org.fiscalProfile
  if (!isCompanyFiscalProfile(fiscal)) return null
  const { companyProfile } = fiscal
  const legalName = org.taxIdentity?.kind === 'company' ? org.taxIdentity.legalName : null
  const tradeName = org.taxIdentity?.kind === 'company' ? (org.taxIdentity.tradeName ?? null) : null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Identidade fiscal</CardTitle>
        <Badge>Empresa formalizada</Badge>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">CNPJ</dt>
          <dd>{formatCnpj(fiscal.taxId)}</dd>
          <dt className="text-muted-foreground">Razão social</dt>
          <dd className="font-medium">{legalName ?? '—'}</dd>
          <dt className="text-muted-foreground">Nome fantasia</dt>
          <dd>{tradeName ?? '—'}</dd>
          <dt className="text-muted-foreground">Regime tributário</dt>
          <dd>{REGIME_LABELS[companyProfile.taxRegime]}</dd>
          <dt className="text-muted-foreground">CNAE principal</dt>
          <dd>
            {companyProfile.primaryActivity.code}
            {companyProfile.primaryActivity.description
              ? ` — ${companyProfile.primaryActivity.description}`
              : ''}
          </dd>
          <dt className="text-muted-foreground">Porte</dt>
          <dd>{SIZE_LABELS[companyProfile.companySize]}</dd>
          <dt className="text-muted-foreground">Situação cadastral</dt>
          <dd>{companyProfile.registrationStatus}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}
