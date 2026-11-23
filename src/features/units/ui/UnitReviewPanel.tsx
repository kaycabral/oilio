'use client'

import type { UnitHoursMode } from '@/domain'
import type { UnitAdditionCost } from '@/shared/billing/unit-cost-preview'
import { formatBRLFromCents } from '@cbrl/br/money'
import { Button, Checkbox, FieldDescription, FieldLabel, Separator } from '@cbrl/design'
import { AlertTriangle } from 'lucide-react'

export type ReviewSummary = {
  name: string
  slug: string
  mobile: string
  email: string
  addressLine: string
  hoursSynthesis: string
  agendaSynthesis: string | null
}

const MODE_LABEL: Record<UnitHoursMode, string> = {
  appointment: 'Por agendamento',
  fixed: 'Ordem de chegada / balcão',
  always_open: 'Sempre aberto · 24h',
}

export function reviewSummaryFromForm(
  form: HTMLFormElement,
  orgSlug: string,
  mode: UnitHoursMode | null,
): ReviewSummary {
  const data = new FormData(form)
  const get = (key: string) => {
    const value = data.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }
  const addressParts = [
    get('street'),
    get('number'),
    get('complement'),
    get('neighborhood'),
    get('city') && get('state') ? `${get('city')}/${get('state')}` : '',
  ].filter(Boolean)

  const enabledDays = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ].filter((day) => data.get(`bh_${day}_enabled`) !== null).length

  const hoursSynthesis = (() => {
    if (mode === null) return ''
    if (mode === 'always_open') return MODE_LABEL[mode]
    const days = enabledDays === 1 ? '1 dia' : `${enabledDays} dias`
    return `${MODE_LABEL[mode]} · ${days} por semana`
  })()

  const agendaSynthesis =
    mode === 'appointment'
      ? `Slots de ${get('slotMinutes')} min · cancelamento pelo cliente ${
          data.get('cancellationEnabled') !== null ? 'ativado' : 'desativado'
        }`
      : null

  return {
    name: get('name'),
    slug: `@${get('slug')} · /${orgSlug}/${get('slug')}`,
    mobile: get('mobile'),
    email: get('email'),
    addressLine: addressParts.join(', '),
    hoursSynthesis,
    agendaSynthesis,
  }
}

function ReviewSection({
  title,
  lines,
  onEdit,
}: {
  title: string
  lines: string[]
  onEdit: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">{title}</p>
        {lines
          .filter((l) => l.length > 0)
          .map((line) => (
            <p key={line} className="text-muted-foreground truncate text-xs">
              {line}
            </p>
          ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Editar
      </Button>
    </div>
  )
}

export function UnitReviewPanel({
  summary,
  cost,
  costAccepted,
  onCostAcceptedChange,
  onEditStep,
}: {
  summary: ReviewSummary
  cost: UnitAdditionCost | null
  costAccepted: boolean
  onCostAcceptedChange: (accepted: boolean) => void
  onEditStep: (step: 'identity' | 'address' | 'hours' | 'agenda') => void
}) {
  return (
    <div className="flex flex-col">
      <div className="divide-border/60 flex flex-col divide-y">
        <ReviewSection
          title="Identidade"
          lines={[summary.name, summary.slug, summary.mobile, summary.email]}
          onEdit={() => onEditStep('identity')}
        />
        <ReviewSection
          title="Endereço"
          lines={[summary.addressLine]}
          onEdit={() => onEditStep('address')}
        />
        <ReviewSection
          title="Funcionamento"
          lines={[summary.hoursSynthesis]}
          onEdit={() => onEditStep('hours')}
        />
        {summary.agendaSynthesis !== null ? (
          <ReviewSection
            title="Agenda"
            lines={[summary.agendaSynthesis]}
            onEdit={() => onEditStep('agenda')}
          />
        ) : null}
      </div>
      {cost?.charged === true ? (
        <>
          <Separator className="my-3" />
          <CostBlock
            preview={cost.preview}
            accepted={costAccepted}
            onAcceptedChange={onCostAcceptedChange}
          />
        </>
      ) : null}
    </div>
  )
}

function CostBlock({
  preview,
  accepted,
  onAcceptedChange,
}: {
  preview: {
    prorationCents: number
    newMonthlyDeltaCents: number
    newTotalMonthlyCents: number
  } | null
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
}) {
  return (
    <div className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Custo adicional desta unidade</p>
      {preview ? (
        <dl className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Cobrado hoje (proporcional)</dt>
            <dd className="font-medium">{formatBRLFromCents(preview.prorationCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">A partir do próximo ciclo</dt>
            <dd className="font-medium">
              + {formatBRLFromCents(preview.newMonthlyDeltaCents)}/mês
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Nova mensalidade total</dt>
            <dd className="font-medium">{formatBRLFromCents(preview.newTotalMonthlyCents)}/mês</dd>
          </div>
        </dl>
      ) : (
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Esta unidade adiciona custo à sua assinatura; o valor exato aparecerá na fatura.
        </p>
      )}
      <FieldLabel className="flex cursor-pointer items-start gap-2 font-normal">
        <Checkbox
          checked={accepted}
          onCheckedChange={(v) => onAcceptedChange(v === true)}
          className="mt-0.5"
        />
        <span className="text-xs">Entendi e concordo com a cobrança adicional</span>
      </FieldLabel>
      {!accepted ? (
        <FieldDescription className="text-xs">
          Marque o aceite pra confirmar a criação.
        </FieldDescription>
      ) : null}
    </div>
  )
}
