"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { Toaster } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/contexts/auth-context"
import { BranchProvider } from "@/contexts/branch-context"
import { NotificationProvider } from "@/contexts/notification-context"
import { AppSettingsProvider } from "@/contexts/settings-context"
import { SyncBootstrap } from "@/components/pwa/sync-bootstrap"
import { KeyboardShortcuts } from "@/components/pwa/keyboard-shortcuts"
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2 * 60 * 1000, gcTime: 10 * 60 * 1000, retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BranchProvider>
            <AppSettingsProvider>
              <NotificationProvider><PwaBootstrap /><SyncBootstrap /><KeyboardShortcuts />{children}</NotificationProvider>
            </AppSettingsProvider>
          </BranchProvider>
          <Toaster richColors position="top-left" theme="light" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
