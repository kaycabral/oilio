import { EditProfileForm } from '@/features/settings/ui/EditProfileForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { getUserDoc } from '@/shared/org/membership'
import { Main } from '@oilio/design'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Meu perfil' }

export default async function MeProfilePage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')

  const user = await getUserDoc(session.uid)
  if (!user) redirect('/login')

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
          defaultName={user.displayName ?? ''}
          defaultMobile={user.mobile ?? ''}
          defaultBirthDate={user.birthDate ?? ''}
        />
      </section>
    </Main>
  )
}
