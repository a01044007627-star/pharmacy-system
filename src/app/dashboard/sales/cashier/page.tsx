import { PageAccess } from "@/components/auth/page-access"
import { CashierView } from "@/features/sales/components/cashier-view"

export default function CashierPage() {
  return <PageAccess permission="sales:read"><CashierView /></PageAccess>
}
