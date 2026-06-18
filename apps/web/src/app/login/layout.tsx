import { CenteredScreen } from '@/components/centered-screen'

// Centers the Google login form in the viewport (shared wrapper). The page
// itself renders only the form — the centering is inherited here so it's not
// copy-pasted per pre-auth screen.
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <CenteredScreen align="start">{children}</CenteredScreen>
}
