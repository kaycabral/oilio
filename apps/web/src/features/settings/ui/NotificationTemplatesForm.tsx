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
} from '@cbrl/design'
import { useMemo, useState } from 'react'

// Plain-language pt-BR names for each template type. Deliberately non-technical
// — the subscription touches used to carry the schedule jargon (D-1/D+1/D+7),
// which meant nothing to a shop owner; the timing lives in the copy, not the
// name.
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
            {/* The visible "Mensagem" label is dropped for a cleaner card — the
                accessible name is kept via aria-label, so screen readers and the
                E2E `getByRole('textbox', { name: 'Mensagem' })` still resolve it.
                Valid placeholders are highlighted inline as the owner types. */}
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
