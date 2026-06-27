import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button, Typography } from '@cbrl/design'

export function Hero() {
  const authEnabled = isFirebaseConfigured()

  return (
    <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
      <span className="text-muted-foreground bg-muted rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase">
        Gestão para serviço recorrente
      </span>
      <Typography
        as="h1"
        variant="h1"
        className="max-w-3xl text-4xl text-balance sm:text-5xl md:text-6xl"
      >
        A plataforma para o seu estabelecimento crescer com recorrência
      </Typography>
      <Typography variant="lead" className="max-w-prose">
        Agenda, assinatura nativa e split fiscal num só lugar. Saia do atendimento avulso e construa
        uma base de clientes que volta todo mês.
      </Typography>
      {authEnabled && (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href="/login">Começar agora</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/pricing">Ver preços</a>
          </Button>
        </div>
      )}
      <Typography variant="muted" className="text-xs">
        Barbearias e estética automotiva já gerenciam o dia a dia no Oilio.
      </Typography>
    </section>
  )
}
