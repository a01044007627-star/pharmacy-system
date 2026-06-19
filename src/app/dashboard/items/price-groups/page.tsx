import { PageAccess } from "@/components/auth/page-access"
import { PriceGroupsView } from "@/features/inventory/components/price-groups-view"

export default function PriceGroupsPage() {
  return <PageAccess permission="inventory:read"><PriceGroupsView /></PageAccess>
}
