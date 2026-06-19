import { PurchaseDetailView } from "@/features/purchases/components/purchase-detail-view"

export default async function PurchaseDetailPage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = await params
  return <PurchaseDetailView purchaseId={purchaseId} />
}
