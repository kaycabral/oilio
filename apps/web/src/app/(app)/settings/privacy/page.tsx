import { DeleteMyDataForm } from '@/features/settings/ui/DeleteMyDataForm'
import { EstablishmentErasureList } from '@/features/settings/ui/EstablishmentErasureList'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { listMyCustomerEstablishments } from '@/shared/identity/org-links'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SettingsSection,
} from '@cbrl/design'
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
    <SettingsSection
      title="Privacidade dos dados"
      description="Exerça seu direito de exclusão (LGPD, art. 18). Para corrigir seus dados, edite seu perfil — a alteração reflete em todas as telas."
    >
      <Card>
        <CardHeader>
          <CardTitle>Estabelecimentos onde você é cliente</CardTitle>
          <CardDescription>
            Você pode excluir seus dados de um estabelecimento específico (mantendo sua conta nos
            demais) ou excluir sua conta inteira de uma vez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EstablishmentErasureList establishments={establishments} />
        </CardContent>
      </Card>

      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Excluir minha conta inteira</CardTitle>
          <CardDescription>
            Seus dados pessoais (nome, WhatsApp, e-mail, data de nascimento) serão{' '}
            <strong>anonimizados de forma irreversível</strong> em todos os estabelecimentos. Seu
            histórico (vendas, comissões, agendamentos) é mantido por obrigação legal, mas passa a
            aparecer com um rótulo neutro. Esta ação não pode ser desfeita.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteMyDataForm />
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
