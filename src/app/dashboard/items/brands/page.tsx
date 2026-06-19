import { PageAccess } from "@/components/auth/page-access"
import { BrandsManagerView } from "@/features/inventory/components/brands-manager-view"

export default function BrandsPage() {
  return <PageAccess permission="inventory:read"><BrandsManagerView /></PageAccess>
}
