import { PageAccess } from "@/components/auth/page-access"
import { UnitsManagerView } from "@/features/inventory/components/units-manager-view"

export default function UnitsPage() {
  return <PageAccess permission="inventory:read"><UnitsManagerView /></PageAccess>
}
