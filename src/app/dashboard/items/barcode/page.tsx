import { PageAccess } from "@/components/auth/page-access"
import { BarcodeLabelsView } from "@/features/inventory/components/barcode-labels-view"

export default function BarcodePage() {
  return <PageAccess permission="settings:barcode.read"><BarcodeLabelsView /></PageAccess>
}
