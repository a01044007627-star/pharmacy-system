import { SaleDetailView } from "@/features/sales/components/sale-detail-view"

export default async function SaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  return <SaleDetailView saleId={saleId} />
}
