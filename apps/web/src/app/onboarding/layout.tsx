import { CenteredScreen } from '@/components/centered-screen'

// Centers every onboarding form (complete-profile, create-Negócio,
// create-first-unit) in the viewport via the shared wrapper — applied once
// here so each page renders only its form, no per-page centering.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <CenteredScreen align="start">{children}</CenteredScreen>
}
