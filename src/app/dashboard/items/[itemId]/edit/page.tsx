import { ItemCreateView } from "@/features/inventory/components/item-create-view"

type PageProps = { params: Promise<{ itemId: string }> }

export default async function EditItemPage({ params }: PageProps) {
  const { itemId } = await params
  return <ItemCreateView itemId={itemId} mode="edit" />
}
