export function numberValue(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value ?? fallback)
  return Number.isFinite(n) ? n : fallback
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }
  return text.replace(/[&<>"']/g, (c) => map[c] ?? c)
}

type WithBarcodes = {
  barcodes?: Array<{ barcode?: string | null; is_primary?: boolean | null }>
  sku?: string | null
}
export function primaryBarcode<T extends WithBarcodes>(item: T, fallback = "—"): string {
  return (
    item.barcodes?.find((b) => b.is_primary)?.barcode ??
    item.barcodes?.[0]?.barcode ??
    item.sku ??
    fallback
  )
}

export function labelFromMap(
  map: Record<string, string>,
  value?: string | null,
  fallback?: string,
): string {
  return map[value ?? ""] ?? value ?? fallback ?? "—"
}
