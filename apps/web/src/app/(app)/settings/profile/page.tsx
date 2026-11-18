import { settingsSectionMeta } from '@/features/settings/core/settings-sections'
import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { track } from '@/shared/lib/track'
import { getActiveOrgContext } from '@/shared/org/membership'
import { Card, CardContent, SettingsSection } from '@oilio/design'
import { redirect } from 'next/navigation'

export default async function ProfileSettingsPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  track('settings_section_viewed', {
    org_id: ctx.membership.orgId,
    user_id: session.uid,
    section: 'profile',
  })

  const meta = settingsSectionMeta('profile')
  return (
    <SettingsSection title={meta.label} description={meta.description}>
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
