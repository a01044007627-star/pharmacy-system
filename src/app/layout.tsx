import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Logixa Pharmacy",
  description: "نظام إدارة الصيدليات المتكامل",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className="antialiased" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  )
}
