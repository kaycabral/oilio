import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

// Self-service rectification surface (brief 0032 / AC-06): the subject edits
// their own global profile. One write reflects live across every screen and
// tenant (identity by reference) — no special flow, no per-record fan-out.
export default async function ProfileSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  return (
    <Main width="narrow" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Meu perfil</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Corrija seus dados pessoais (LGPD, art. 18). A alteração reflete em todas as telas onde
          seu nome aparece.
        </p>
      </header>

      <section className="rounded-lg border p-6">
        <EditProfileForm
          defaultName={ctx.user.displayName ?? ''}
          defaultWhatsapp={ctx.user.whatsapp ?? ''}
          defaultBirthDate={ctx.user.birthDate ?? ''}
        />
      </section>
    </Main>
  )
}
