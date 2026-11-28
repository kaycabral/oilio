import { LoginVisual } from '@/components/LoginVisual'
import { AuthSplitScreen } from '@cbrl/design'

export const instant = false

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitScreen visual={<LoginVisual />}>{children}</AuthSplitScreen>
}
