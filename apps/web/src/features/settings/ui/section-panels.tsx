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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cbrl/design'

// The section BODIES rendered inside the Configurações modal (brief 0090). Just
// the content blocks — the section title + description live in the modal's
// DialogHeader (SETTINGS_SECTIONS meta), so they are not repeated here. The
// `/settings/X` full pages wrap the same feature components in a SettingsSection
// header instead; both converge on the components below, so they never drift.

export function ProfilePanel({ data }: { data: ProfileSectionData }) {
  return (
    <Card>
      <CardContent>
        <EditProfileForm
          defaultName={data.defaultName}
          defaultMobile={data.defaultMobile}
          defaultBirthDate={data.defaultBirthDate}
        />
      </CardContent>
    </Card>
  )
}

export function PrivacyPanel({ data }: { data: PrivacySectionData }) {
  return (
    <div className="flex flex-col gap-6">
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
    </div>
  )
}

export function NotificationsPanel({ data }: { data: NotificationsSectionData }) {
  return <NotificationTemplatesForm templates={data.templates} canManage={data.canManage} />
}

export function BillingPanelSection({ data }: { data: BillingSectionData }) {
  return (
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
  )
}
