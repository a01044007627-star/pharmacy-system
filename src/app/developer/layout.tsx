import { DeveloperShell } from "@/features/developer/components/developer-shell"

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <DeveloperShell>{children}</DeveloperShell>
}
