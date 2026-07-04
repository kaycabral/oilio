import BillingPage from '@/app/(app)/settings/billing/page'
import { RouteModal } from '@/features/settings/ui/RouteModal'

// Intercepts /settings/billing as the Cobrança section of the Configurações
// modal (brief 0090, AC-08). The page keeps requireManagerPage + getOrgBilling +
// RLS server-side; a direct load / refresh renders it full-page.
export default function BillingModal() {
  return (
    <RouteModal activeSection="billing">
      <BillingPage />
    </RouteModal>
  )
}
