import { redirect } from "next/navigation"

type PageProps = { params: Promise<{ itemId: string }> }

export default async function ItemCardRedirect({ params }: PageProps) {
  const { itemId } = await params
  redirect(`/dashboard/items/${itemId}`)
}
