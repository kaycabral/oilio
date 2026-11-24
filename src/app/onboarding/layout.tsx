import { CenteredScreen } from '@/components/centered-screen'

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <CenteredScreen align="start">{children}</CenteredScreen>
}
