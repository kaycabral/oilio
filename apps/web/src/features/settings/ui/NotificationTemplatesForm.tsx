'use client'

import {
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  renderNotificationTemplate,
  type MessageTemplate,
  type NotificationTemplateVars,
} from '@/domain'
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
  Label,
  Switch,
  Textarea,
  Typography,
} from '@cbrl/design'
import { useMemo, useState } from 'react'

const TYPE_LABELS: Record<string, string> = {
  birthday: 'Aniversário',
  subscription_expiring_tomorrow: 'Assinatura vence amanhã (D-1)',
  subscription_expired: 'Assinatura vencida (D+1)',
  subscription_overdue_followup: 'Follow-up de vencimento (D+7)',
  new_customer: 'Novo cliente',
}

// Dados de exemplo pro preview (AC-15) — renderiza como o cliente vê.
const SAMPLE_VARS: NotificationTemplateVars = {
  cliente_nome: 'Maria',
  servico: 'corte + barba',
  valor: 'R$ 50',
  voucher_atual: 'hidratação grátis',
}

function templateLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

// Only the ENABLED templates show their full editor (an off template has nothing
// worth editing — brief 0090 cleanup). The disabled ones collapse into a compact
// "desativadas" list where they can be turned back on, so hiding them is never a
// dead end.
export function NotificationTemplatesForm({
  templates,
  canManage,
}: {
  templates: MessageTemplate[]
  canManage: boolean
}) {
  const active = useMemo(() => templates.filter((t) => t.enabled), [templates])
  const disabled = useMemo(() => templates.filter((t) => !t.enabled), [templates])
  // In the modal, a save that flips `enabled` moves a template between the active
  // editors and the disabled list — reload the section so the split reflects it.
  // On the full page `revalidatePath` in the action already re-renders the route.
  const reloadSection = useSettingsReload()

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-muted/40 rounded-md border p-3 text-sm">
        <p className="font-medium">Placeholders disponíveis</p>
        <p className="text-muted-foreground mt-1">
          {NOTIFICATION_TEMPLATE_PLACEHOLDERS.map((p) => (
            <code key={p} className="bg-background mr-1 rounded px-1 py-0.5 text-xs">
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

  const preview = renderNotificationTemplate(body, SAMPLE_VARS)

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
            <div className="space-y-1">
              <Label htmlFor={`body-${template.type}`}>Mensagem</Label>
              <Textarea
                id={`body-${template.type}`}
                name="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-1">
              <span className="text-muted-foreground text-xs font-medium">
                Preview (dados de exemplo)
              </span>
              <p className="bg-muted/40 rounded-md border p-3 text-sm whitespace-pre-wrap">
                {preview}
              </p>
            </div>

            {result && !result.ok && <p className="text-destructive text-sm">{result.error}</p>}
            {result && result.ok && <p className="text-sm text-green-600">Salvo!</p>}

            <Button type="submit" disabled={!canManage || pending} className="w-fit">
              {pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </fieldset>
        </CardContent>
      </form>
    </Card>
  )
}

// Compact list of the off templates: name + a switch to turn back on. Turning it
// on submits immediately (keeping the current body) so it reappears above with
// its editor. No editor here — a disabled template has nothing to configure yet.
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
