import { isAuthConfigured } from '@/shared/auth/config'
import { Button, Typography } from '@cbrl/design'

export function Hero() {
  const authEnabled = isAuthConfigured()

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
        Pare de vender atendimento. Comece a construir receita.
      </Typography>
      <Typography variant="lead" className="max-w-prose">
        Agenda, assinatura e comissão trabalham juntas num só lugar. Você transforma o cliente
        avulso numa base que volta — e paga — todo mês.
      </Typography>
      {authEnabled && (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href="/signup/business">Começar agora</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/pricing">Ver preços</a>
          </Button>
        </div>
      )}
      <Typography variant="muted" className="text-xs">
        Barbearias e estética automotiva já rodam o dia a dia no Oilio.
      </Typography>
    </section>
  )
}
