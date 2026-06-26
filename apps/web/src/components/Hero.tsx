import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button } from '@cbrl/design'

export function Hero() {
  const authEnabled = isFirebaseConfigured()

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Oilio</h1>
      <p className="text-muted-foreground max-w-prose text-lg">
        Gestão para negócios de serviço recorrente — agenda, assinatura e split fiscal em uma
        plataforma moderna.
      </p>
      {authEnabled && (
        <div className="flex gap-3">
          <Button asChild>
            <a href="/login">Entrar</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/dashboard">Dashboard</a>
          </Button>
        </div>
      )}
    </section>
  )
}
