import { MARKETING_CONTAINER } from '@/components/marketing/container'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { cn } from '@oilio/design'

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <MarketingHeader />
      <main className={cn(MARKETING_CONTAINER, 'flex-1')}>{children}</main>
      <MarketingFooter />
    </div>
  )
}
