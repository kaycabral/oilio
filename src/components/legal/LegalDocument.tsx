import { MarketingShell } from '@/components/marketing/MarketingShell'
import { Typography } from '@cbrl/design'

export const LEGAL_LAST_UPDATED = '27 de novembro de 2026'

export { PRIVACY_PATH, TERMS_PATH } from '@/components/legal/paths'

export const CONTROLLER_NAME = '[A DEFINIR: razão social]'
export const CONTROLLER_TAX_ID = '[A DEFINIR: CNPJ]'
export const CONTROLLER_ADDRESS = '[A DEFINIR: endereço]'
export const PRIVACY_CONTACT_EMAIL = '[A DEFINIR: e-mail do encarregado]'
export const JURISDICTION = '[A DEFINIR: cidade/UF]'

export function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl space-y-4 py-16 text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        <header className="space-y-2">
          <Typography as="h1" variant="h1" className="text-3xl">
            {title}
          </Typography>
          <Typography variant="muted">Última atualização: {LEGAL_LAST_UPDATED}</Typography>
        </header>
        {children}
      </article>
    </MarketingShell>
  )
}
