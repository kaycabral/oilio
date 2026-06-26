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
import { Button, Label, Switch, Textarea } from '@cbrl/design'
import { useState } from 'react'

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

export function NotificationTemplatesForm({
  templates,
  canManage,
}: {
  templates: MessageTemplate[]
  canManage: boolean
}) {
  return (
    <div className="space-y-4">
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
      {templates.map((t) => (
        <TemplateCard key={t.type} template={t} canManage={canManage} />
      ))}
    </div>
  )
}

function TemplateCard({ template, canManage }: { template: MessageTemplate; canManage: boolean }) {
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
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={onSubmit} className="space-y-3 rounded-md border p-4">
      <input type="hidden" name="type" value={template.type} />
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{TYPE_LABELS[template.type] ?? template.type}</h2>
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

      <fieldset disabled={!canManage || pending} className="space-y-3">
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
          <p className="bg-muted/40 rounded-md border p-3 text-sm whitespace-pre-wrap">{preview}</p>
        </div>

        {result && !result.ok && <p className="text-destructive text-sm">{result.error}</p>}
        {result && result.ok && <p className="text-sm text-green-600">Salvo!</p>}

        <Button type="submit" disabled={!canManage || pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </fieldset>
    </form>
  )
}
