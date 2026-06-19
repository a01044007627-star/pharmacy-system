import { PageAccess } from "@/components/auth/page-access"
import { ItemCreateView } from "@/features/inventory/components/item-create-view"

export default function NewItemPage() {
  return <PageAccess permission="inventory:create"><ItemCreateView /></PageAccess>
}
