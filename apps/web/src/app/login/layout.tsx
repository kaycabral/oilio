import { CenteredScreen } from '@/components/centered-screen'

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <CenteredScreen align="start">{children}</CenteredScreen>
}
