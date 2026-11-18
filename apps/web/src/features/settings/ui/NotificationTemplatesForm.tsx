'use client'

import { NOTIFICATION_TEMPLATE_PLACEHOLDERS, type MessageTemplate } from '@/domain'
import {
  updateMessageTemplate,
  type UpdateTemplateResult,
} from '@/features/settings/adapters/notifications.actions'
import { useSettingsReload } from '@/features/settings/ui/settings-modal-context'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HighlightedTextarea,
  Label,
  Switch,
  Typography,
} from '@oilio/design'
import { useMemo, useState } from 'react'

const TYPE_LABELS: Record<string, string> = {
  birthday: 'Aniversário',
  subscription_expiring_tomorrow: 'Assinatura vencendo',
  subscription_expired: 'Assinatura vencida',
  subscription_overdue_followup: 'Lembrete de renovação',
  new_customer: 'Novo cliente',
}

function templateLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export function NotificationTemplatesForm({
  templates,
  canManage,
}: {
  templates: MessageTemplate[]
  canManage: boolean
}) {
  const active = useMemo(() => templates.filter((t) => t.enabled), [templates])
  const disabled = useMemo(() => templates.filter((t) => !t.enabled), [templates])
  const reloadSection = useSettingsReload()

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-muted/40 rounded-md border p-3 text-sm">
        <p className="font-medium">Campos disponíveis</p>
        <p className="text-muted-foreground mt-1">
          Digite um destes na mensagem — ele é preenchido com os dados do cliente no envio.
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          {NOTIFICATION_TEMPLATE_PLACEHOLDERS.map((p) => (
            <code
              key={p}
              className="bg-primary/15 text-primary rounded-[3px] px-1 py-0.5 text-xs font-medium"
            >
              {p}
            </code>
          ))}
        </p>
      </div>

      {active.length > 0 ? (
        active.map((t) => (
          <TemplateCard key={t.type} template={t} canManage={canManage} onSaved={reloadSection} />
        ))
      ) : (
        <Typography variant="muted" className="text-sm">
          Nenhuma notificação ativa. Reative uma das opções abaixo para configurá-la.
        </Typography>
      )}

      {disabled.length > 0 && (
        <DisabledTemplates templates={disabled} canManage={canManage} onSaved={reloadSection} />
      )}
    </div>
  )
}

function TemplateCard({
  template,
  canManage,
  onSaved,
}: {
  template: MessageTemplate
  canManage: boolean
  onSaved: (() => void) | null
}) {
  const [body, setBody] = useState(template.body)
  const [enabled, setEnabled] = useState(template.enabled)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<UpdateTemplateResult | null>(null)

  async function onSubmit(formData: FormData) {
    setPending(true)
    setResult(null)
    try {
      const r = await updateMessageTemplate(formData)
      setResult(r)
      if (r.ok) onSaved?.()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <form action={onSubmit}>
        <input type="hidden" name="type" value={template.type} />
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{templateLabel(template.type)}</CardTitle>
            <Label className="flex items-center gap-2 text-sm">
              <Switch
                name="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canManage}
              />
              Ativo
            </Label>
          </div>
        </CardHeader>

        <CardContent>
          <fieldset disabled={!canManage || pending} className="flex flex-col gap-3">
            <HighlightedTextarea
              id={`body-${template.type}`}
              name="body"
              aria-label="Mensagem"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              tokens={NOTIFICATION_TEMPLATE_PLACEHOLDERS}
              rows={4}
            />

            {result && !result.ok && <p className="text-destructive text-sm">{result.error}</p>}

            <div className="flex items-center justify-end gap-3">
              {result && result.ok && <span className="text-sm text-green-600">Salvo!</span>}
              <Button type="submit" disabled={!canManage || pending}>
                {pending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </form>
    </Card>
  )
}

function DisabledTemplates({
  templates,
  canManage,
  onSaved,
}: {
  templates: MessageTemplate[]
  canManage: boolean
  onSaved: (() => void) | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <Typography variant="muted" className="text-xs font-medium uppercase">
        Desativadas
      </Typography>
      <div className="flex flex-col divide-y rounded-md border">
        {templates.map((t) => (
          <DisabledTemplateRow key={t.type} template={t} canManage={canManage} onSaved={onSaved} />
        ))}
      </div>
    </div>
  )
}

function DisabledTemplateRow({
  template,
  canManage,
  onSaved,
}: {
  template: MessageTemplate
  canManage: boolean
  onSaved: (() => void) | null
}) {
  const [pending, setPending] = useState(false)

  async function reenable(formData: FormData) {
    setPending(true)
    try {
      const r = await updateMessageTemplate(formData)
      if (r.ok) onSaved?.()
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={reenable} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <input type="hidden" name="type" value={template.type} />
      <input type="hidden" name="body" value={template.body} />
      <input type="hidden" name="enabled" value="on" />
      <span className="text-muted-foreground">{templateLabel(template.type)}</span>
      <Button type="submit" variant="outline" size="sm" disabled={!canManage || pending}>
        {pending ? 'Ativando…' : 'Ativar'}
      </Button>
    </form>
  )
}
