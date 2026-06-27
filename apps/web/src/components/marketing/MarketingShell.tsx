import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { MarketingHeader } from '@/components/marketing/MarketingHeader'

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6">{children}</main>
      <MarketingFooter />
    </div>
  )
}
