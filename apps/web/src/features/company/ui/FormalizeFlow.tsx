'use client'

import { formatCnpj, isValidCompanyTaxId, normalizeTaxId } from '@/domain'
import { formalizeUnit } from '@/features/company/adapters/formalize.actions'
import { readJson } from '@/shared/http'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@cbrl/design'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// The shape `/api/tax-id/[taxId]` returns (the normalized `CompanyLookup`).
type CompanyLookupResponse = {
  profile: {
    taxId: string
    isMei: boolean
    taxRegime: 'mei' | 'simples_nacional' | 'other'
    primaryActivity: { code: string; description: string }
    secondaryActivities: { code: string; description: string }[]
    companySize: 'micro' | 'small' | 'other'
    legalNature: string
    registrationStatus: string
    shareCapital: number
    activityStartedAt: string
  }
  legalName: string
  tradeName: string | null
}

const REGIME_LABELS: Record<CompanyLookupResponse['profile']['taxRegime'], string> = {
  mei: 'MEI',
  simples_nacional: 'Simples Nacional',
  other: 'Outro',
}

const SIZE_LABELS: Record<CompanyLookupResponse['profile']['companySize'], string> = {
  micro: 'Microempresa',
  small: 'Pequeno porte',
  other: 'Demais',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function asCnae(v: unknown): { code: string; description: string } {
  if (!isRecord(v)) return { code: '', description: '' }
  return { code: asString(v.code), description: asString(v.description) }
}

function asRegime(v: unknown): CompanyLookupResponse['profile']['taxRegime'] {
  return v === 'mei' || v === 'simples_nacional' ? v : 'other'
}

function asSize(v: unknown): CompanyLookupResponse['profile']['companySize'] {
  return v === 'micro' || v === 'small' ? v : 'other'
}

// Build the typed lookup from the untyped JSON the route returns — field by
// field, no cast (the route already decoded + normalized; this re-narrows).
function validateLookup(data: unknown): CompanyLookupResponse {
  if (!isRecord(data) || !isRecord(data.profile)) throw new Error('Resposta inválida')
  const p = data.profile
  if (typeof p.taxId !== 'string' || typeof data.legalName !== 'string') {
    throw new Error('Resposta inválida')
  }
  const secondary = Array.isArray(p.secondaryActivities) ? p.secondaryActivities.map(asCnae) : []
  return {
    profile: {
      taxId: p.taxId,
      isMei: p.isMei === true,
      taxRegime: asRegime(p.taxRegime),
      primaryActivity: asCnae(p.primaryActivity),
      secondaryActivities: secondary,
      companySize: asSize(p.companySize),
      legalNature: asString(p.legalNature),
      registrationStatus: asString(p.registrationStatus),
      shareCapital: asNumber(p.shareCapital),
      activityStartedAt: asString(p.activityStartedAt),
    },
    legalName: data.legalName,
    tradeName: typeof data.tradeName === 'string' ? data.tradeName : null,
  }
}

function validateErrorBody(data: unknown): { error?: string } {
  if (!isRecord(data)) return {}
  return { error: typeof data.error === 'string' ? data.error : undefined }
}

type Step = 'input' | 'review'

export function FormalizeFlow({ unitId }: { unitId: string }) {
  const [step, setStep] = useState<Step>('input')
  const [cnpj, setCnpj] = useState('')
  const [lookup, setLookup] = useState<CompanyLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [confirming, startConfirm] = useTransition()

  const digits = normalizeTaxId(cnpj)
  const canLookup = isValidCompanyTaxId(digits)

  async function onLookup() {
    setError(null)
    setLooking(true)
    try {
      const res = await fetch(`/api/tax-id/${digits}`)
      if (!res.ok) {
        // The API's own `error` is a curated business message ("CNPJ não
        // encontrado.") — surface it. A missing body means a technical failure
        // (network / unexpected status) whose raw text must not leak: fall back
        // to a fixed friendly message (disclosure wall, brief 0085).
        const body = await readJson(res, validateErrorBody).catch((): { error?: string } => ({}))
        setError(body.error ?? 'Falha na consulta do CNPJ. Tente novamente.')
        return
      }
      const data = await readJson(res, validateLookup)
      setLookup(data)
      setStep('review')
    } catch {
      // A thrown error here is technical (network / parse) — never user-facing text.
      setError('Falha na consulta do CNPJ. Tente novamente.')
    } finally {
      setLooking(false)
    }
  }

  function onConfirm(formData: FormData) {
    setError(null)
    startConfirm(async () => {
      const res = await formalizeUnit(formData)
      if (!res.ok) setError(res.error)
      else toast.success('Unidade formalizada')
    })
  }

  if (step === 'review' && lookup) {
    const { profile, legalName, tradeName } = lookup
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confira os dados da Receita</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Confirme que estes são os dados da sua empresa antes de formalizar. A formalização é um
            upgrade — nada do que você já cadastrou é perdido.
          </p>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">CNPJ</dt>
            <dd>{formatCnpj(profile.taxId)}</dd>
            <dt className="text-muted-foreground">Razão social</dt>
            <dd className="font-medium">{legalName}</dd>
            <dt className="text-muted-foreground">Nome fantasia</dt>
            <dd>{tradeName ?? '—'}</dd>
            <dt className="text-muted-foreground">Regime tributário</dt>
            <dd>{REGIME_LABELS[profile.taxRegime]}</dd>
            <dt className="text-muted-foreground">CNAE principal</dt>
            <dd>
              {profile.primaryActivity.code}
              {profile.primaryActivity.description
                ? ` — ${profile.primaryActivity.description}`
                : ''}
            </dd>
            <dt className="text-muted-foreground">Porte</dt>
            <dd>{SIZE_LABELS[profile.companySize]}</dd>
            <dt className="text-muted-foreground">Situação cadastral</dt>
            <dd>{profile.registrationStatus}</dd>
          </dl>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <form action={onConfirm} className="flex justify-end gap-2">
            <input type="hidden" name="unitId" value={unitId} />
            <input type="hidden" name="taxId" value={profile.taxId} />
            <input type="hidden" name="legalName" value={legalName} />
            <input type="hidden" name="tradeName" value={tradeName ?? ''} />
            <input type="hidden" name="profile" value={JSON.stringify(profile)} />
            <Button
              type="button"
              variant="outline"
              disabled={confirming}
              onClick={() => {
                setStep('input')
                setError(null)
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={confirming}>
              {confirming ? 'Formalizando…' : 'Confirmar e formalizar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Formalizar unidade</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Tem CNPJ? Informe-o para anexar a identidade fiscal a esta unidade. Buscamos os dados na
          Receita e você confirma antes de formalizar.
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="formalize-cnpj" className="text-sm font-medium">
            CNPJ
          </Label>
          <Input
            id="formalize-cnpj"
            name="cnpj"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => setCnpj(formatCnpj(e.target.value))}
          />
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canLookup || looking}
            onClick={() => {
              void onLookup()
            }}
          >
            {looking ? 'Consultando…' : 'Consultar CNPJ'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
