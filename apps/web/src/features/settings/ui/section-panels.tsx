'use client'

import { BillingPanel } from '@/features/billing/ui/BillingPanel'
import type {
  BillingSectionData,
  NotificationsSectionData,
  PrivacySectionData,
  ProfileSectionData,
} from '@/features/settings/adapters/settings-loaders'
import { DeleteMyDataForm } from '@/features/settings/ui/DeleteMyDataForm'
import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { EstablishmentErasureList } from '@/features/settings/ui/EstablishmentErasureList'
import { NotificationTemplatesForm } from '@/features/settings/ui/NotificationTemplatesForm'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SettingsSection,
} from '@cbrl/design'

// The section panels rendered inside the Configurações modal (brief 0090, bug
// #13 fix). These are the presentational client counterparts of the
// `/settings/X` server pages: same header (SettingsSection) + same body UI, but
// fed by props the loader actions return instead of fetching inline. The server
// pages still render their own copy for full-page / deep-link loads — both paths
// converge on the same feature components below, so the two never drift.

export function ProfilePanel({ data }: { data: ProfileSectionData }) {
  return (
    <SettingsSection
      title="Meu perfil"
      description="Corrija seus dados pessoais (LGPD, art. 18). A alteração reflete em todas as telas onde seu nome aparece."
    >
      <Card>
        <CardContent>
          <EditProfileForm
            defaultName={data.defaultName}
            defaultMobile={data.defaultMobile}
            defaultBirthDate={data.defaultBirthDate}
          />
        </CardContent>
      </Card>
    </SettingsSection>
  )
}

export function PrivacyPanel({ data }: { data: PrivacySectionData }) {
  return (
    <SettingsSection
      title="Privacidade dos dados"
      description="Exerça seu direito de exclusão (LGPD, art. 18). Para corrigir seus dados, edite seu perfil — a alteração reflete em todas as telas."
    >
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
          <EstablishmentErasureList establishments={data.establishments} />
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

export function NotificationsPanel({ data }: { data: NotificationsSectionData }) {
  return (
    <SettingsSection
      title="Templates de notificação"
      description="Personalize as mensagens enviadas por WhatsApp. Use os placeholders pra inserir dados do cliente automaticamente."
    >
      <NotificationTemplatesForm templates={data.templates} canManage={data.canManage} />
    </SettingsSection>
  )
}

export function BillingPanelSection({ data }: { data: BillingSectionData }) {
  return (
    <SettingsSection
      title="Cobrança"
      description="Veja seu plano atual, quantas unidades estão sendo cobradas e gerencie sua assinatura do Oilio."
    >
      <BillingPanel
        tier={data.tier}
        status={data.status}
        billingCycle={data.billingCycle}
        unitQuantity={data.unitQuantity}
        unitCount={data.unitCount}
        orgName={data.orgName}
        currentPeriodEnd={data.currentPeriodEnd}
        cancelAtPeriodEnd={data.cancelAtPeriodEnd}
        hasStripeCustomer={data.hasStripeCustomer}
        canManageBilling={data.canManageBilling}
        paymentMethod={data.paymentMethod}
        invoices={data.invoices}
      />
    </SettingsSection>
  )
}
