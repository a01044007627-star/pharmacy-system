"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle } from "lucide-react"
import { DailyProfitDialog } from "@/components/shared/daily-profit-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { mergeKpiValues } from "../data"
import type { DashboardDateFilter } from "../types"
import { buildTableConfigs } from "../table-configs"
import { useDashboardHomeData } from "../hooks"
import { DashboardHero } from "./dashboard-hero"
import { DashboardKpiCard } from "./dashboard-kpi-card"
import { DashboardLineChart } from "./dashboard-line-chart"
import { DashboardReportTable } from "./dashboard-report-table"

function KpiSkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-[116px] rounded-3xl bg-white/75" />
      ))}
    </div>
  )
}

export function DashboardHomeView() {
  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>("today")
  const [branchFilter, setBranchFilter] = useState("all")
  const [dailyProfitOpen, setDailyProfitOpen] = useState(false)
  const { data, loading, error } = useDashboardHomeData(dateFilter, branchFilter)
  const [tablesReady, setTablesReady] = useState(false)

  useEffect(() => {
    if (loading) {
      setTablesReady(false)
      return
    }

    if (typeof window === "undefined") {
      setTablesReady(true)
      return
    }

    const win = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (win.requestIdleCallback) {
      const idleId = win.requestIdleCallback(() => setTablesReady(true), { timeout: 350 })
      return () => win.cancelIdleCallback?.(idleId)
    }

    const timerId = win.setTimeout(() => setTablesReady(true), 80)
    return () => win.clearTimeout(timerId)
  }, [loading])

  const kpis = useMemo(() => mergeKpiValues(data), [data])
  const tableConfigs = useMemo(() => buildTableConfigs(data.tables), [data.tables])

  return (
    <div dir="rtl" className="min-h-[calc(100dvh-4rem)] bg-[#edf5fa] pb-10 text-right">
      <section className="mx-auto w-full max-w-[1500px] space-y-5 px-4 sm:px-5 lg:px-6">
        <DashboardHero
          dateFilter={dateFilter}
          branchFilter={branchFilter}
          loading={loading}
          onDateFilterChange={setDateFilter}
          onBranchFilterChange={setBranchFilter}
        />

        {error ? (
          <Alert className="rounded-2xl border-red-200 bg-red-50 text-red-950">
            <AlertCircle className="size-4" />
            <AlertTitle className="font-black">تعذر تحميل البيانات الحقيقية</AlertTitle>
            <AlertDescription className="font-bold">{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && data.generatedAt === new Date(0).toISOString() ? (
          <KpiSkeletonGrid />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((item) => (
              <DashboardKpiCard key={item.id} item={item} onOpenDailyProfit={() => setDailyProfitOpen(true)} loading={loading} />
            ))}
          </div>
        )}

        <div className="space-y-5">
          <DashboardLineChart chart={data.salesLast30DaysChart} loading={loading} />
          <DashboardLineChart chart={data.currentFinancialYearChart} loading={loading} />
        </div>

        {tablesReady ? (
          <div className="space-y-5">
            <DashboardReportTable config={tableConfigs.customerDebts} loading={loading} />
            <DashboardReportTable config={tableConfigs.supplierDebts} loading={loading} />
            <DashboardReportTable config={tableConfigs.stockWarning} loading={loading} />
            <DashboardReportTable config={tableConfigs.expiryAlert} loading={loading} />
            <DashboardReportTable config={tableConfigs.orders} loading={loading} />
            <DashboardReportTable config={tableConfigs.purchaseRequests} loading={loading} />
            <DashboardReportTable config={tableConfigs.pendingShipments} loading={loading} />
          </div>
        ) : (
          <div className="space-y-5">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-[220px] rounded-3xl bg-white/80" />
            ))}
          </div>
        )}
      </section>

      <DailyProfitDialog open={dailyProfitOpen} onOpenChange={setDailyProfitOpen} />
    </div>
  )
}
