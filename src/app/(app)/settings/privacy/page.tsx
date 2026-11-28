import { settingsSectionMeta } from '@/features/settings/core/settings-sections'
import { DeleteMyDataForm } from '@/features/settings/ui/DeleteMyDataForm'
import { EstablishmentErasureList } from '@/features/settings/ui/EstablishmentErasureList'
import { getSessionUser } from '@/shared/auth/session'
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
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

export default async function PrivacySettingsPage() {
  await connection()
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
    section: 'privacy',
  })

  const establishments = await listMyCustomerEstablishments(session.uid)

  const meta = settingsSectionMeta('privacy')
  return (
    <SettingsSection title={meta.label} description={meta.description}>
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Estabelecimentos onde você é cliente</h2>
          </CardTitle>
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
          <CardTitle asChild className="text-destructive">
            <h2>Excluir minha conta inteira</h2>
          </CardTitle>
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
