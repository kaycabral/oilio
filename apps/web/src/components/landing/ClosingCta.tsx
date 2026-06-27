import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button, Typography } from '@cbrl/design'

export function ClosingCta() {
  if (!isFirebaseConfigured()) return null

  return (
    <section className="bg-muted my-16 flex flex-col items-center gap-6 rounded-2xl px-6 py-16 text-center">
      <Typography as="h2" variant="h2" className="border-none pb-0">
        Pronto pra construir receita recorrente?
      </Typography>
      <Typography variant="muted" className="max-w-prose text-base">
        Crie a conta do seu estabelecimento em segundos e comece a organizar agenda, equipe e
        assinaturas hoje mesmo.
      </Typography>
      <Button asChild size="lg">
        <a href="/login">Começar agora</a>
      </Button>
    </section>
  )
}
