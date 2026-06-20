"use client"

import { useCallback, useEffect, useRef } from "react"

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

const FALLBACK_FREQUENCIES: Record<SoundName, number> = {
  "barcode-scan": 880,
  success: 740,
  error: 180,
  warning: 320,
  notification: 620,
  "cash-register": 520,
  "payment-received": 760,
  "item-added": 680,
  "drawer-open": 460,
  "shift-start": 620,
  "shift-end": 360,
  "low-stock": 240,
  "void-transaction": 210,
  reminder: 540,
}

type AudioContextConstructor = typeof AudioContext

type UseSoundOptions = {
  enabled?: boolean
  defaultVolume?: number
}

let sharedContext: AudioContext | null = null
let audioUnlocked = false

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const constructor = (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext)
  if (!constructor) return null
  sharedContext ??= new constructor()
  return sharedContext
}

async function unlockBrowserAudio() {
  const context = getAudioContext()
  if (context?.state === "suspended") {
    await context.resume().catch(() => undefined)
  }
  audioUnlocked = context?.state === "running" || audioUnlocked
}

function fallbackBeep(name: SoundName, volume: number) {
  const context = getAudioContext()
  if (!context || context.state !== "running") return
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime
  oscillator.type = name === "error" || name === "warning" || name === "low-stock" ? "square" : "sine"
  oscillator.frequency.setValueAtTime(FALLBACK_FREQUENCIES[name], now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume * 0.16), now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.15)
}

export function useSound(options: UseSoundOptions = {}) {
  const cache = useRef<Map<SoundName, HTMLAudioElement>>(new Map())
  const enabled = options.enabled ?? true
  const defaultVolume = Math.min(1, Math.max(0, options.defaultVolume ?? 0.5))

  const unlock = useCallback(async () => {
    await unlockBrowserAudio()
    if (typeof Audio === "undefined") return
    for (const [name, path] of Object.entries(SOUND_PATHS) as Array<[SoundName, string]>) {
      if (cache.current.has(name)) continue
      const audio = new Audio(path)
      audio.preload = "auto"
      audio.load()
      cache.current.set(name, audio)
    }
  }, [])

  useEffect(() => {
    const handleInteraction = () => { void unlock() }
    window.addEventListener("pointerdown", handleInteraction, { once: true, capture: true })
    window.addEventListener("keydown", handleInteraction, { once: true, capture: true })
    window.addEventListener("touchstart", handleInteraction, { once: true, capture: true })
    return () => {
      window.removeEventListener("pointerdown", handleInteraction, true)
      window.removeEventListener("keydown", handleInteraction, true)
      window.removeEventListener("touchstart", handleInteraction, true)
    }
  }, [unlock])

  const play = useCallback(async (name: SoundName, volume = defaultVolume) => {
    if (!enabled || typeof Audio === "undefined") return false
    const safeVolume = Math.min(1, Math.max(0, volume))
    if (!audioUnlocked) await unlockBrowserAudio()

    let base = cache.current.get(name)
    if (!base) {
      base = new Audio(SOUND_PATHS[name])
      base.preload = "auto"
      base.load()
      cache.current.set(name, base)
    }

    const audio = base.cloneNode(true) as HTMLAudioElement
    audio.volume = safeVolume
    audio.currentTime = 0
    try {
      await audio.play()
      return true
    } catch {
      fallbackBeep(name, safeVolume)
      return false
    }
  }, [defaultVolume, enabled])

  return { play, unlock, enabled }
}
