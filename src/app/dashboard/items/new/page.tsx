import { PageAccess } from "@/components/auth/page-access"
import { ItemCreateView } from "@/features/inventory/components/item-create-view"

type PageProps = {
  searchParams: Promise<{ duplicate?: string | string[]; pharmacy_id?: string | string[] }>
}

export default async function NewItemPage({ searchParams }: PageProps) {
  const query = await searchParams
  const duplicateFromId = Array.isArray(query.duplicate) ? query.duplicate[0] : query.duplicate
  const pharmacyId = Array.isArray(query.pharmacy_id) ? query.pharmacy_id[0] : query.pharmacy_id
  return (
    <PageAccess permission="inventory:create">
      <ItemCreateView duplicateFromId={duplicateFromId} pharmacyId={pharmacyId} />
    </PageAccess>
  )
}
