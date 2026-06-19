"use client"

import { memo, useMemo } from "react"
import { CalendarDays, MapPin, RefreshCw } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DashboardDateFilter } from "../types"

function getDisplayName(profileName?: string | null, email?: string | null) {
  const name = profileName?.trim() || email?.split("@")[0] || "المستخدم"
  return name || "المستخدم"
}

const dateOptions: Array<{ value: DashboardDateFilter; label: string }> = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "الأمس" },
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "آخر 30 يومًا" },
  { value: "thisMonth", label: "هذا الشهر" },
  { value: "lastMonth", label: "الشهر الماضي" },
  { value: "thisYear", label: "هذه السنة" },
  { value: "lastYear", label: "العام الماضي" },
  { value: "fiscalYear", label: "السنة المالية الحالية" },
]

interface DashboardHeroProps {
  dateFilter: DashboardDateFilter
  branchFilter: string
  loading?: boolean
  onDateFilterChange: (value: DashboardDateFilter) => void
  onBranchFilterChange: (value: string) => void
}

export const DashboardHero = memo(function DashboardHero({
  dateFilter,
  branchFilter,
  loading,
  onDateFilterChange,
  onBranchFilterChange,
}: DashboardHeroProps) {
  const { profile, user, activePharmacy, activeBranch, branches, isDeveloper, isOwner, role } = useAuth()
  const displayName = getDisplayName(profile?.full_name, user?.email)
  const canSelectAll = isDeveloper || isOwner || ["owner", "admin", "manager", "accountant"].includes(role)

  const locationOptions = useMemo(() => {
    const options: { value: string; label: string }[] = []
    if (canSelectAll) {
      options.push({ value: "all", label: activePharmacy?.name ? `كل فروع ${activePharmacy.name}` : "كل الفروع" })
    }

    const seen = new Set(options.map((option) => option.value))
    for (const branch of branches) {
      if (seen.has(branch.id)) continue
      seen.add(branch.id)
      options.push({ value: branch.id, label: `${branch.name}${branch.code ? ` (${branch.code})` : ""}` })
    }

    if (!options.length && activeBranch) {
      options.push({ value: activeBranch.id, label: activeBranch.name })
    }

    return options
  }, [activeBranch, activePharmacy?.name, branches, canSelectAll])

  const safeBranchFilter = locationOptions.some((option) => option.value === branchFilter)
    ? branchFilter
    : (locationOptions[0]?.value ?? "all")

  const currentBranchLabel = locationOptions.find((option) => option.value === safeBranchFilter)?.label ?? "كل الفروع"
  const currentDateLabel = dateOptions.find((option) => option.value === dateFilter)?.label ?? "اليوم"

  return (
    <section className="relative overflow-visible rounded-[28px] bg-brand px-5 py-6 text-white shadow-[0_18px_45px_rgba(37,99,235,0.22)] sm:px-7 lg:px-9">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-4 text-right">
          <div className="min-w-0">
            <h1 className="max-w-full break-words text-3xl font-black leading-[1.15] tracking-tight sm:text-4xl lg:text-[44px] 2xl:text-5xl">
              أهلاً وسهلاً، <span dir="ltr" className="inline-block max-w-full align-baseline">{displayName}</span>
            </h1>
            <p className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm font-black text-slate-100">
              {loading ? <RefreshCw className="size-4 animate-spin" /> : null}
              <span>{isDeveloper ? "وضع مراجعة المطور" : activeBranch?.name ?? activePharmacy?.name ?? "لوحة متابعة الصيدلية"}</span>
            </p>
          </div>
          <span className="hidden shrink-0 text-5xl leading-none sm:block" aria-hidden="true">👋</span>
        </div>

        <div className="grid w-full shrink-0 gap-3 sm:grid-cols-2 xl:w-[600px]">
          <Select value={safeBranchFilter} onValueChange={(value: string | null) => value && onBranchFilterChange(value)}>
            <SelectTrigger dir="rtl" className="h-11 w-full rounded-2xl border-slate-100 bg-white px-4 text-sm font-black text-slate-800 shadow-none [&_svg]:text-slate-500">
              <MapPin className="size-4 shrink-0" />
              <SelectValue placeholder="اختر الموقع">{currentBranchLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent side="bottom" sideOffset={12} align="start" alignItemWithTrigger={false} className="z-[9999] rounded-2xl border-0 p-2 text-right shadow-2xl">
              {locationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="h-10 justify-end text-sm font-bold">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateFilter} onValueChange={(value: string | null) => value && onDateFilterChange(value as DashboardDateFilter)}>
            <SelectTrigger dir="rtl" className="h-11 w-full rounded-2xl border-slate-100 bg-white px-4 text-sm font-black text-slate-800 shadow-none [&_svg]:text-slate-600">
              <CalendarDays className="size-4 shrink-0" />
              <SelectValue placeholder="تصفية حسب التاريخ">{currentDateLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent side="bottom" sideOffset={12} align="start" alignItemWithTrigger={false} className="z-[9999] max-h-[360px] rounded-2xl border-0 p-2 text-right shadow-2xl">
              {dateOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="h-10 justify-end text-sm font-bold">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
})
