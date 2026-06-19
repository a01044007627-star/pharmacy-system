import { PageAccess } from "@/components/auth/page-access"
import { GroupsManagerView } from "@/features/inventory/components/groups-manager-view"

export default function GroupsPage() {
  return <PageAccess permission="inventory:read"><GroupsManagerView /></PageAccess>
}
