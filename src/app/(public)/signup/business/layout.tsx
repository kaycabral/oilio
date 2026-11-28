import { LoginVisual } from '@/components/LoginVisual'
import { AuthSplitScreen } from '@cbrl/design'

export default function SignupBusinessLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitScreen visual={<LoginVisual />}>{children}</AuthSplitScreen>
}
