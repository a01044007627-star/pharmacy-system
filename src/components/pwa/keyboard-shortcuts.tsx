"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAppSettings } from "@/contexts/settings-context"

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

function findSearchControl() {
  return document.querySelector<HTMLInputElement>(
    'input[type="search"], input[data-shortcut-search="true"], input[placeholder*="ابحث"], input[placeholder*="بحث"], input[placeholder*="الباركود"]',
  )
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const settings = useAppSettings()
  const enabled = settings.bool("shortcuts", "enableShortcuts", true)

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (event.key === "F8") {
        event.preventDefault()
        router.push("/dashboard/sales/cashier")
        return
      }

      if (modifier && key === "n" && pathname.startsWith("/dashboard")) {
        event.preventDefault()
        router.push("/dashboard/items/new")
        return
      }

      if (modifier && key === "f") {
        const search = findSearchControl()
        if (search) {
          event.preventDefault()
          search.focus()
          search.select()
        }
        return
      }

      if (modifier && key === "p" && !isEditableTarget(event.target)) {
        event.preventDefault()
        window.print()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, pathname, router])

  return null
}
