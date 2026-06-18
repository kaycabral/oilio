'use client'

import {
  DEFAULT_CANCELLATION_POLICY,
  MAX_CANCELLATION_NOTICE_MINUTES,
  MIN_CANCELLATION_NOTICE_MINUTES,
  ORG_DESCRIPTION_MAX,
  VERTICALS,
  type Org,
  type Vertical,
} from '@/domain'
import { updateCompany } from '@/features/company/adapters/company.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@cbrl/design'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

const VERTICAL_LABELS: Record<Vertical, string> = {
  barbershop: 'Barbearia',
  auto_wash: 'Lavagem automotiva',
  auto_detailing: 'Estética automotiva',
  other: 'Outro',
}

export function CompanyForm({ org, canManage }: { org: Org; canManage: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [taxKind, setTaxKind] = useState<'none' | 'individual' | 'company'>(
    org.taxIdentity?.kind ?? 'none',
  )
  const [cancellationEnabled, setCancellationEnabled] = useState(org.cancellationPolicy.enabled)
  const [cancellationMinNotice, setCancellationMinNotice] = useState<number>(
    org.cancellationPolicy.minNoticeMinutes || DEFAULT_CANCELLATION_POLICY.minNoticeMinutes,
  )
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateCompany(formData)
      if (!res.ok) setError(res.error)
      else toast.success('Empresa atualizada')
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-4"
    >
      <fieldset disabled={!canManage || pending} className="contents">
        <div className="flex flex-col gap-1">
          <Label htmlFor="company-name" className="text-sm font-medium">
            Nome
          </Label>
          <Input id="company-name" name="name" defaultValue={org.name} required minLength={2} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="company-slug" className="text-sm font-medium">
            Slug público
          </Label>
          <Input
            id="company-slug"
            name="slug"
            defaultValue={org.slug}
            required
            minLength={3}
            maxLength={64}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
          />
          <span className="text-muted-foreground text-xs">
            Identificador na URL pública. Apenas letras minúsculas, dígitos e hífens.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="company-vertical" className="text-sm font-medium">
            Vertical
          </Label>
          <Select name="vertical" defaultValue={org.vertical} required>
            <SelectTrigger id="company-vertical">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VERTICALS.map((v) => (
                <SelectItem key={v} value={v}>
                  {VERTICAL_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="border-border rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Identidade fiscal (opcional)</legend>
          <div className="flex gap-3 py-2">
            {(['none', 'individual', 'company'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="taxKind"
                  value={k}
                  checked={taxKind === k}
                  onChange={() => setTaxKind(k)}
                />
                {(() => {
                  if (k === 'none') return 'Sem informar'
                  if (k === 'individual') return 'Pessoa física'
                  return 'Pessoa jurídica'
                })()}
              </label>
            ))}
          </div>
          {taxKind !== 'none' ? (
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="company-taxId" className="text-sm font-medium">
                  {taxKind === 'individual' ? 'CPF' : 'CNPJ'}
                </Label>
                <Input
                  id="company-taxId"
                  name="taxId"
                  defaultValue={org.taxIdentity?.taxId ?? ''}
                  placeholder={taxKind === 'individual' ? '000.000.000-00' : '00.000.000/0000-00'}
                  required
                />
              </div>
              {taxKind === 'company' ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="company-legalName" className="text-sm font-medium">
                    Razão social
                  </Label>
                  <Input
                    id="company-legalName"
                    name="legalName"
                    defaultValue={
                      org.taxIdentity?.kind === 'company' ? org.taxIdentity.legalName : ''
                    }
                    required
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="border-border rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Identidade pública</legend>
          <p className="text-muted-foreground pt-2 pb-3 text-xs">
            Aparece na página pública <code>app/{org.slug || 'sua-empresa'}</code>. Logo e banner
            são URLs públicas (https://...) — hospedagem direta vem em iteração futura.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="company-brandingLogoUrl" className="text-sm font-medium">
                URL do logo
              </Label>
              <Input
                id="company-brandingLogoUrl"
                name="brandingLogoUrl"
                type="url"
                defaultValue={org.branding.logoUrl ?? ''}
                placeholder="https://..."
                maxLength={2048}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="company-brandingBannerUrl" className="text-sm font-medium">
                URL do banner
              </Label>
              <Input
                id="company-brandingBannerUrl"
                name="brandingBannerUrl"
                type="url"
                defaultValue={org.branding.bannerUrl ?? ''}
                placeholder="https://..."
                maxLength={2048}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Descrição curta</span>
              <Textarea
                name="brandingDescription"
                defaultValue={org.branding.description ?? ''}
                rows={3}
                maxLength={ORG_DESCRIPTION_MAX}
                placeholder="Apresente o estabelecimento em poucas linhas."
              />
              <span className="text-muted-foreground text-xs">
                Até {ORG_DESCRIPTION_MAX} caracteres.
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="border-border rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Políticas</legend>
          <p className="text-muted-foreground pt-2 pb-3 text-xs">
            Política de cancelamento aplicada ao auto-serviço do cliente. Quando ativa, a página
            pública de agendamento mostra a antecedência sugerida. Cancelar continua sempre
            disponível — a política comunica a expectativa, sem bloquear.
          </p>
          <div className="flex items-center gap-2 pb-3 text-sm">
            <Checkbox
              id="company-cancellationPolicyEnabled"
              name="cancellationPolicyEnabled"
              value="on"
              checked={cancellationEnabled}
              onCheckedChange={(checked) => setCancellationEnabled(checked === true)}
            />
            <Label htmlFor="company-cancellationPolicyEnabled" className="font-normal">
              Ativar política de cancelamento
            </Label>
          </div>
          {cancellationEnabled ? (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="company-cancellationPolicyMinNoticeMinutes"
                className="text-sm font-medium"
              >
                Antecedência mínima sugerida
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="company-cancellationPolicyMinNoticeMinutes"
                  name="cancellationPolicyMinNoticeMinutes"
                  type="number"
                  inputMode="numeric"
                  min={MIN_CANCELLATION_NOTICE_MINUTES}
                  max={MAX_CANCELLATION_NOTICE_MINUTES}
                  step={1}
                  required
                  value={cancellationMinNotice}
                  onChange={(e) => setCancellationMinNotice(Number(e.target.value))}
                  className="max-w-[6rem]"
                />
                <span className="text-muted-foreground text-sm">minutos</span>
              </div>
              <span className="text-muted-foreground text-xs">
                Comunicada ao cliente na confirmação pré-reserva. Default 120 minutos (2h).
              </span>
            </div>
          ) : (
            // Preserve the last entered value across disable/re-enable so the
            // org doesn't have to retype after toggling off.
            <input
              type="hidden"
              name="cancellationPolicyMinNoticeMinutes"
              value={cancellationMinNotice}
            />
          )}
        </fieldset>

        <fieldset className="border-border rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Mensagem de confirmação (WhatsApp)</legend>
          <p className="text-muted-foreground pt-2 pb-3 text-xs">
            Template usado ao clicar em "Enviar confirmação" depois de criar/reagendar. Variáveis
            disponíveis: <code>{'{customerName}'}</code>, <code>{'{businessName}'}</code>,{' '}
            <code>{'{serviceName}'}</code>, <code>{'{professionalName}'}</code>,{' '}
            <code>{'{date}'}</code>, <code>{'{time}'}</code>. Deixe em branco para usar o padrão.
          </p>
          <Textarea
            name="whatsappConfirmation"
            defaultValue={org.whatsappTemplates.confirmation}
            rows={4}
          />
        </fieldset>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={pending || !canManage || !isValid}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
