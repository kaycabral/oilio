import { BrandMark } from '@/components/brand-mark'
import { PRIVACY_PATH, TERMS_PATH } from '@/components/legal/paths'
import { MARKETING_CONTAINER } from '@/components/marketing/container'
import { Typography, cn } from '@cbrl/design'

export function MarketingFooter() {
  return (
    <footer className="border-border/60 mt-24 border-t">
      <div
        className={cn(
          MARKETING_CONTAINER,
          'text-muted-foreground flex flex-col items-center justify-between gap-4 py-10 text-sm sm:flex-row',
        )}
      >
        <span className="text-foreground flex items-center gap-2 font-semibold">
          <BrandMark className="size-5" />
          Oilio
        </span>
        <nav className="flex items-center gap-6">
          <a href="/pricing" className="hover:text-foreground transition-colors">
            Preços
          </a>
          <a href="/login" className="hover:text-foreground transition-colors">
            Entrar
          </a>
          <a href={TERMS_PATH} className="hover:text-foreground transition-colors">
            Termos
          </a>
          <a href={PRIVACY_PATH} className="hover:text-foreground transition-colors">
            Privacidade
          </a>
        </nav>
        <Typography variant="muted" className="text-xs">
          © 2026 Oilio. Gestão para serviço recorrente.
        </Typography>
      </div>
    </footer>
  )
}
