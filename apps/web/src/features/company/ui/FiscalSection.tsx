import {
  formatCnpj,
  isCompanyUnitFiscal,
  type CompanySize,
  type TaxIdentity,
  type TaxRegime,
  type Unit,
} from '@/domain'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@oilio/design'

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

export function FiscalSection({
  unit,
  taxIdentity,
}: {
  unit: Unit
  taxIdentity: TaxIdentity | null
}) {
  const fiscal = unit.fiscal
  if (!isCompanyUnitFiscal(fiscal)) return null
  const { companyProfile } = fiscal
  const legalName = taxIdentity?.kind === 'company' ? taxIdentity.legalName : null
  const tradeName = taxIdentity?.kind === 'company' ? (taxIdentity.tradeName ?? null) : null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Identidade fiscal</CardTitle>
        <Badge>Unidade formalizada</Badge>
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
