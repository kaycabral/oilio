import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button } from '@cbrl/design'

export function MarketingHeader() {
  const authEnabled = isFirebaseConfigured()

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 w-full border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <a href="/" className="text-lg font-semibold tracking-tight">
          Oilio
        </a>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="/pricing">Preços</a>
          </Button>
          {authEnabled && (
            <>
              <Button asChild variant="ghost" size="sm">
                <a href="/login">Entrar</a>
              </Button>
              <Button asChild size="sm">
                <a href="/login">Começar agora</a>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
