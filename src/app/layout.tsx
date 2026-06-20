import type { Metadata, Viewport } from "next"
import { Providers } from "@/components/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Logixa Pharmacy",
  description: "نظام إدارة الصيدليات المتكامل",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192x192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pharmacy" },
}

export const viewport: Viewport = {
  themeColor: "#0b63a8",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className="antialiased" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  )
}
