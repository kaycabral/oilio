import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Button, Typography } from '@cbrl/design'

export function ClosingCta() {
  if (!isFirebaseConfigured()) return null

  return (
    <section className="bg-muted my-16 flex flex-col items-center gap-6 rounded-2xl px-6 py-16 text-center">
      <Typography as="h2" variant="h2" className="border-none pb-0">
        Comece a construir sua receita recorrente hoje
      </Typography>
      <Typography variant="muted" className="max-w-prose text-base">
        Crie a conta do seu negócio em segundos. Organize agenda, equipe e assinaturas antes do
        próximo cliente entrar.
      </Typography>
      <Button asChild size="lg">
        <a href="/login">Começar agora</a>
      </Button>
    </section>
  )
}
