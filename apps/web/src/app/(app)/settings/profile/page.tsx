import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

// Self-service rectification surface (brief 0032 / AC-06): the subject edits
// their own global profile. One write reflects live across every screen and
// org (identity by reference) — no special flow, no per-record fan-out.
export default async function ProfileSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  // Product telemetry (brief 0090 § "Eventos"): the Perfil section was viewed —
  // covers both the full page and the Configurações modal (which renders this
  // same server page). Emitted server-side; track() reaches the server logger.
  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
    section: 'profile',
  })

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
          defaultMobile={ctx.user.mobile ?? ''}
          defaultBirthDate={ctx.user.birthDate ?? ''}
        />
      </section>
    </Main>
  )
}
