import { DeleteMyDataForm } from '@/features/settings/ui/DeleteMyDataForm'
import { EstablishmentErasureList } from '@/features/settings/ui/EstablishmentErasureList'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { listMyCustomerEstablishments } from '@/shared/identity/org-links'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

// Self-service privacy surface (brief 0032 / AC-07 + AC-10): the subject's own
// account area where they exercise the LGPD right to erasure. They discover the
// establishments where they are a CUSTOMER (via the identity-layer reverse index
// `users/{uid}/org_links` — a per-user read, NOT a cross-org query) and,
// per establishment, can either block their data there (per-org, #1100) or
// erase their whole account (global anonymization, #1093). Anonymization is
// irreversible and account-level; records are retained de-identified (AC-04).
export default async function PrivacySettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
    section: 'privacy',
  })

  // Per-user read of the subject's OWN reverse index — discovers where they are
  // a customer without any cross-org query (ADR 0004 clarifying note).
  const establishments = await listMyCustomerEstablishments(session.uid)

  return (
    <Main width="narrow" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Privacidade dos dados</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Exerça seu direito de exclusão (LGPD, art. 18). Para corrigir seus dados, edite seu perfil
          — a alteração reflete em todas as telas.
        </p>
      </header>

      <section className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">Estabelecimentos onde você é cliente</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          Você pode excluir seus dados de um estabelecimento específico (mantendo sua conta nos
          demais) ou excluir sua conta inteira de uma vez.
        </p>
        <EstablishmentErasureList establishments={establishments} />
      </section>

      <section className="border-destructive/40 rounded-lg border p-6">
        <h2 className="text-destructive text-lg font-semibold">Excluir minha conta inteira</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          Seus dados pessoais (nome, WhatsApp, e-mail, data de nascimento) serão{' '}
          <strong>anonimizados de forma irreversível</strong> em todos os estabelecimentos. Seu
          histórico (vendas, comissões, agendamentos) é mantido por obrigação legal, mas passa a
          aparecer com um rótulo neutro. Esta ação não pode ser desfeita.
        </p>
        <DeleteMyDataForm />
      </section>
    </Main>
  )
}
