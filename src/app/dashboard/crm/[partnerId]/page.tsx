import { PartnerDetailView } from "@/features/partners/components/partner-detail-view"

export default async function PartnerDetailPage(props: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await props.params
  return <PartnerDetailView partnerId={partnerId} />
}
