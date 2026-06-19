import { ItemDetailView } from "@/features/inventory/components/item-detail-view"

type PageProps = {
  params: Promise<{ itemId: string }>
  searchParams: Promise<{ pharmacy_id?: string | string[] }>
}

export default async function ItemDetailsPage({ params, searchParams }: PageProps) {
  const [{ itemId }, query] = await Promise.all([params, searchParams])
  const pharmacyId = Array.isArray(query.pharmacy_id) ? query.pharmacy_id[0] : query.pharmacy_id
  return <ItemDetailView itemId={itemId} pharmacyId={pharmacyId} />
}
