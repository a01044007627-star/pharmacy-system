"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Toaster } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/contexts/auth-context"
import { BranchProvider } from "@/contexts/branch-context"
import { NotificationProvider } from "@/contexts/notification-context"
import { AppSettingsProvider } from "@/contexts/settings-context"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2 * 60 * 1000, gcTime: 10 * 60 * 1000, retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false },
        },
      }),
  )

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BranchProvider>
            <AppSettingsProvider>
              <NotificationProvider>{children}</NotificationProvider>
            </AppSettingsProvider>
          </BranchProvider>
          <Toaster richColors position="top-left" theme="light" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
