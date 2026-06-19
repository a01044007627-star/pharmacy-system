import { redirect } from "next/navigation"

type PageProps = {
  params: Promise<{ itemId: string }>
  searchParams: Promise<{ pharmacy_id?: string | string[] }>
}

export default async function ItemCardRedirect({ params, searchParams }: PageProps) {
  const [{ itemId }, query] = await Promise.all([params, searchParams])
  const pharmacyId = Array.isArray(query.pharmacy_id) ? query.pharmacy_id[0] : query.pharmacy_id
  const suffix = pharmacyId ? `?pharmacy_id=${encodeURIComponent(pharmacyId)}` : ""
  redirect(`/dashboard/items/${itemId}${suffix}`)
}
