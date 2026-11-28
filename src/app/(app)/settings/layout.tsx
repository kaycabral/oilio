import { Main } from '@cbrl/design'

export const instant = false

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <Main width="narrow">{children}</Main>
}
