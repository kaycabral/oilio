import { CenteredScreen } from '@/components/centered-screen'

export const instant = false

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <CenteredScreen align="start">{children}</CenteredScreen>
}
