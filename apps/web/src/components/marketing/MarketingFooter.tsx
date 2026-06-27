import { Typography } from '@cbrl/design'

export function MarketingFooter() {
  return (
    <footer className="border-border/60 mt-24 border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm sm:flex-row">
        <span className="text-foreground font-semibold">Oilio</span>
        <nav className="flex items-center gap-6">
          <a href="/pricing" className="hover:text-foreground transition-colors">
            Preços
          </a>
          <a href="/login" className="hover:text-foreground transition-colors">
            Entrar
          </a>
        </nav>
        <Typography variant="muted" className="text-xs">
          © 2026 Oilio. Gestão para serviço recorrente.
        </Typography>
      </div>
    </footer>
  )
}
