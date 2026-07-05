import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { settingsSectionMeta } from '@/features/settings/ui/settings-sections'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Card, CardContent, SettingsSection } from '@cbrl/design'
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

  const meta = settingsSectionMeta('profile')
  return (
    <SettingsSection title={meta.title} description={meta.description}>
      <Card>
        <CardContent>
          <EditProfileForm
            defaultName={ctx.user.displayName ?? ''}
            defaultMobile={ctx.user.mobile ?? ''}
            defaultBirthDate={ctx.user.birthDate ?? ''}
          />
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
