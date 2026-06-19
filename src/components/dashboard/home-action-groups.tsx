"use client"

import type { CSSProperties } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import {
  BarChart3,
  Box,
  Building,
  Calculator,
  CheckSquare,
  ClipboardList,
  DollarSign,
  FileText,
  Lock,
  Package,
  RefreshCw,
  Settings,
  Sparkles,
  Store,
  Truck,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { homeActionGroups } from "@/config/home-actions"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

const iconMap: Record<string, LucideIcon> = {
  "cash-register": Calculator,
  "file-chart": BarChart3,
  rotate: RefreshCw,
  layers: Box,
  users: Users,
  receipt: FileText,
  "user-round": UserCheck,
  asterisk: CheckSquare,
  banknote: Wallet,
  gem: Package,
  store: Store,
  truck: Truck,
  barcode: FileText,
  list: ClipboardList,
  settings: Settings,
  shield: Lock,
  "hand-coins": DollarSign,
  package: Package,
}

const groupToneMap = {
  sales: {
    main: "#167fa3", ink: "#075985", soft: "#edf8ff",
    border: "#b8d8ea", shadow: "rgba(7, 89, 133, 0.14)", strongShadow: "rgba(7, 54, 76, 0.24)",
  },
  purchases: {
    main: "#d5b800", ink: "#785f00", soft: "#fff8d9",
    border: "#ead88b", shadow: "rgba(120, 95, 0, 0.14)", strongShadow: "rgba(99, 77, 0, 0.23)",
  },
  inventory: {
    main: "#1db4c3", ink: "#087b86", soft: "#e9fbfc",
    border: "#afe7eb", shadow: "rgba(8, 123, 134, 0.14)", strongShadow: "rgba(6, 92, 100, 0.23)",
  },
  admin: {
    main: "#4b80ed", ink: "#234da9", soft: "#eef3ff",
    border: "#bfd0ff", shadow: "rgba(35, 77, 169, 0.14)", strongShadow: "rgba(23, 55, 122, 0.23)",
  },
} as const

function toneStyle(tone: (typeof groupToneMap)[keyof typeof groupToneMap]) {
  return {
    "--group-main": tone.main,
    "--group-ink": tone.ink,
    "--group-soft": tone.soft,
    "--group-border": tone.border,
    "--group-shadow": tone.shadow,
    "--group-shadow-strong": tone.strongShadow,
  } as CSSProperties
}

function getDisplayName(user: ReturnType<typeof useAuth>["user"], profile: ReturnType<typeof useAuth>["profile"]) {
  const rawName = profile?.full_name
    ?? (user?.user_metadata?.display_name as string | undefined)
    ?? (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split("@")[0]
    ?? "مستخدم النظام"

  return rawName.trim().split(/\s+/)[0] ?? rawName
}

function WelcomeHeader() {
  const { user, profile, activePharmacy, activeBranch, isDeveloper } = useAuth()
  const displayName = getDisplayName(user, profile)

  return (
    <Card className="mb-8 border-[#cfe0ea] bg-white/80 py-0 shadow-[0_16px_36px_rgba(15,23,42,0.08)] backdrop-blur">
      <CardContent className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-right">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#0b4968] text-white shadow-lg shadow-[#0b5b7b]/20"
            style={{ backgroundImage: "linear-gradient(to bottom right, #0b5b7b, #172554)" }}
          >
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
              أهلاً وسهلاً، {displayName}
            </h1>
            <p className="mt-1 text-sm font-bold text-slate-500">
              اختار القسم وابدأ شغلك بسرعة من مجموعات التشغيل الرئيسية.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          <Badge className="h-9 rounded-xl bg-[#edf8ff] px-3 text-[12px] font-black text-[#075985] ring-1 ring-[#bae6fd]">
            {isDeveloper ? "وضع المطور" : "مستخدم مفعل"}
          </Badge>
          <Badge className="h-9 rounded-xl bg-[#ecfdf5] px-3 text-[12px] font-black text-[#047857] ring-1 ring-[#a7f3d0]">
            <Building className="ml-1 size-3.5" />
            {activeBranch?.name ?? activePharmacy?.name ?? "كل الصيدليات"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

export function HomeActionGroups() {
  return (
    <section dir="rtl" className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4 lg:px-5">
      <WelcomeHeader />

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2 2xl:grid-cols-4">
        {homeActionGroups.map((group) => {
          const tone = groupToneMap[group.tone]

          return (
            <div key={group.title} className="min-w-0" style={toneStyle(tone)}>
              <div className="mb-0 flex flex-col items-center">
                <div
                  className={cn(
                    "home-group-label relative z-10 rounded-xl border px-7 py-3 text-center text-lg font-black leading-none ring-1 ring-white/70",
                  )}
                >
                  {group.title}
                </div>
                <div
                  className="home-group-line h-9 w-1 rounded-b-full shadow-sm"
                />
              </div>

              <div className="grid auto-rows-[125px] grid-cols-2 gap-3">
                {group.items.map((item) => {
                  const Icon = iconMap[item.icon] ?? Package
                  const isWide = item.size === "wide"

                  return (
                    <Link
                      key={`${group.title}-${item.title}`}
                      href={item.href}
                      className={cn(
                        "home-action-tile group relative overflow-hidden rounded-lg border p-5 transition duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-bg",
                        isWide ? "col-span-2" : "col-span-1",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute -bottom-10 -left-10 size-28 rounded-full opacity-0 transition duration-300 group-hover:scale-125 group-hover:opacity-100",
                          "bg-white/15",
                        )}
                      />
                      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-white/35" />
                      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-10 bg-black/5" />

                      <span
                        className={cn(
                          "relative z-10 flex h-full gap-4",
                          isWide ? "items-center justify-between" : "flex-col items-center justify-center text-center",
                        )}
                      >
                        <span className={cn("font-black leading-7 drop-shadow-sm", isWide ? "text-xl" : "text-base")}>{item.title}</span>
                        <Icon className={cn("text-white drop-shadow-sm", isWide ? "size-16" : "size-12")} strokeWidth={2.15} />
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
