import { LoginVisual } from '@/components/LoginVisual'
import { AuthSplitScreen } from '@oilio/design'

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitScreen visual={<LoginVisual />}>{children}</AuthSplitScreen>
}
