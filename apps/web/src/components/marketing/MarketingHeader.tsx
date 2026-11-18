import { MARKETING_CONTAINER } from '@/components/marketing/container'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button, cn } from '@oilio/design'

export function MarketingHeader() {
  const authEnabled = isFirebaseConfigured()

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 w-full border-b backdrop-blur">
      <div className={cn(MARKETING_CONTAINER, 'flex h-14 items-center justify-between')}>
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
                <a href="/signup/business">Começar agora</a>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
