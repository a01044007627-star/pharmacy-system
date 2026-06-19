import { PageAccess } from "@/components/auth/page-access"
import { DamagedStockView } from "@/features/inventory/components/damaged-stock-view"

export default function DamagedPage() {
  return <PageAccess permission="inventory:read"><DamagedStockView /></PageAccess>
}
