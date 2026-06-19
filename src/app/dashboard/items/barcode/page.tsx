import { PageAccess } from "@/components/auth/page-access"
import { BarcodeLabelsView } from "@/features/inventory/components/barcode-labels-view"
import { BarcodePrintView } from "@/features/inventory/components/barcode-print-view"

export default async function BarcodePage(props: { searchParams: Promise<{ item?: string }> }) {
  const searchParams = await props.searchParams
  const itemId = searchParams.item

  return (
    <PageAccess permission="settings:barcode.read">
      {itemId ? <BarcodePrintView /> : <BarcodeLabelsView />}
    </PageAccess>
  )
}
