import { PageAccess } from "@/components/auth/page-access"
import { ItemsListView } from "@/features/inventory/components/items-list-view"

export default function DeletedItemsPage() {
  return <PageAccess permission="deleted-records:read"><ItemsListView mode="deleted" /></PageAccess>
}
