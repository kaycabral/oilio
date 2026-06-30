'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { generateClientInvite } from '@/features/customers/adapters/customers.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { Copy, Send } from 'lucide-react'
import { useState, useTransition } from 'react'

export type InviteUnitOption = { slug: string; name: string }

// Contextual client-invite surface (brief 0077, Grupo B — #1279). Replaces the
// "novo cliente" form: the recepcionista informs the WhatsApp number + the unit
// the invite is for, and the system hands back a contextual signup link + a
// `wa.me` deep link to send. No Customer with recep-typed PII is created — the
// customer materializes their own account (login → complete) and lands on that
// unit's booking. This kills the wrong-number ghost at the source.
export function ClientInviteForm({ units }: { units: InviteUnitOption[] }) {
  // Single-unit orgs don't need a chooser — the only unit is implied.
  const singleUnit = units.length === 1 ? units[0]! : null
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ whatsappHref: string; inviteUrl: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    setResult(null)
    setCopied(false)
    startTransition(async () => {
      const res = await generateClientInvite(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setResult({ whatsappHref: res.whatsappHref, inviteUrl: res.inviteUrl })
      // Open WhatsApp with the pre-filled message in a new tab.
      window.open(res.whatsappHref, '_blank', 'noopener,noreferrer')
    })
  }

  function onCopy(url: string): void {
    navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        ref={formRef}
        action={onSubmit}
        onInput={refresh}
        onChange={refresh}
        className="flex flex-col gap-3"
      >
        {singleUnit ? (
          <input type="hidden" name="unit" value={singleUnit.slug} />
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-unit" className="text-sm font-medium">
              Unidade
            </Label>
            <Select name="unit" required>
              <SelectTrigger id="invite-unit">
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.slug} value={u.slug}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-whatsapp" className="text-sm font-medium">
            WhatsApp do cliente
          </Label>
          <PhoneInput id="invite-whatsapp" name="whatsapp" required />
          <span className="text-muted-foreground text-xs">
            Você só informa o número. O próprio cliente faz o cadastro pelo link — sem digitar os
            dados dele aqui.
          </span>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={pending || !isValid}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            {pending ? 'Gerando…' : 'Enviar convite'}
          </Button>
        </div>
      </form>

      {result ? (
        <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p className="text-foreground/90">
            Convite gerado. O WhatsApp deve ter aberto com a mensagem pronta — se não, use o link
            abaixo.
          </p>
          <code className="bg-background text-muted-foreground block w-full rounded px-2 py-1 font-mono text-xs break-all">
            {result.inviteUrl}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopy(result.inviteUrl)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={result.whatsappHref} target="_blank" rel="noopener noreferrer">
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Abrir WhatsApp
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
