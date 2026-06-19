"use client"

import { useCallback, useRef } from "react"

export type SoundName =
  | "barcode-scan"
  | "success"
  | "error"
  | "warning"
  | "notification"
  | "cash-register"
  | "payment-received"
  | "item-added"
  | "drawer-open"
  | "shift-start"
  | "shift-end"
  | "low-stock"
  | "void-transaction"
  | "reminder"

const SOUND_PATHS: Record<SoundName, string> = {
  "barcode-scan": "/sounds/barcode-scan.wav",
  success: "/sounds/success.wav",
  error: "/sounds/error.wav",
  warning: "/sounds/warning.wav",
  notification: "/sounds/notification.wav",
  "cash-register": "/sounds/cash-register.wav",
  "payment-received": "/sounds/payment-received.wav",
  "item-added": "/sounds/item-added.wav",
  "drawer-open": "/sounds/drawer-open.wav",
  "shift-start": "/sounds/shift-start.wav",
  "shift-end": "/sounds/shift-end.wav",
  "low-stock": "/sounds/low-stock.wav",
  "void-transaction": "/sounds/void-transaction.wav",
  reminder: "/sounds/reminder.wav",
}

export function useSound() {
  const cache = useRef<Map<string, HTMLAudioElement>>(new Map())

  const play = useCallback((name: SoundName, volume = 0.5) => {
    const path = SOUND_PATHS[name]
    if (!path) return

    let audio = cache.current.get(name)
    if (!audio) {
      audio = new Audio(path)
      audio.preload = "auto"
      cache.current.set(name, audio)
    }

    audio.volume = volume
    audio.currentTime = 0
    audio.play().catch(() => {})
  }, [])

  return { play }
}
