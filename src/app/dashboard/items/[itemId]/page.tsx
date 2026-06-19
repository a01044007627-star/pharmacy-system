import { ItemDetailView } from "@/features/inventory/components/item-detail-view"

type PageProps = { params: Promise<{ itemId: string }> }

export default async function ItemDetailsPage({ params }: PageProps) {
  const { itemId } = await params
  return <ItemDetailView itemId={itemId} />
}
