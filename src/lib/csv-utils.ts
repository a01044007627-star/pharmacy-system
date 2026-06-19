const escapeValue = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`

export function downloadCsv(filename: string, data: string[][]): void {
  const content = data.map((row) => row.map(escapeValue).join(",")).join("\n")
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
