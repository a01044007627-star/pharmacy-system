import { PageAccess } from "@/components/auth/page-access"
import { PriceUpdateView } from "@/features/inventory/components/price-update-view"

export default function PriceUpdatePage() {
  return <PageAccess permission="inventory:update"><PriceUpdateView /></PageAccess>
}
