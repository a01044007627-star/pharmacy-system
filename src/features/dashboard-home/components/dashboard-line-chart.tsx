"use client"

import { memo, useMemo, useId } from "react"
import { ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { DashboardChartData } from "../types"

const W = 1120
const H = 300
const PX = 58
const PY = 32
const UW = H - PY * 2

function fmt(v: number) {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))
}

function buildPath(values: number[], max: number) {
  if (!values.length) return ""
  const step = values.length > 1 ? (W - PX * 2) / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = PX + step * i
      const y = PY + UW - (max === 0 ? 0 : (v / max) * UW)
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

interface DashboardLineChartProps {
  chart: DashboardChartData
  loading?: boolean
}

export const DashboardLineChart = memo(function DashboardLineChart({ chart, loading }: DashboardLineChartProps) {
  const uid = useId()

  const { max, ticks, paths } = useMemo(() => {
    const raw = Math.max(1, ...chart.series.flatMap((s) => s.values))
    const magnitude = raw >= 100000 ? 50000 : raw >= 10000 ? 5000 : raw >= 1000 ? 500 : 100
    const m = Math.ceil(raw / magnitude) * magnitude || 1000
    return {
      max: m,
      ticks: Array.from({ length: 5 }, (_, i) => Math.round((m / 4) * i)),
      paths: chart.series.map((s) => ({ ...s, path: buildPath(s.values, m) })),
    }
  }, [chart.series])

  const everyNth = chart.labels.length > 18 ? 2 : 1
  const isEmpty = chart.series.every((serie) => serie.values.every((value) => value === 0))

  return (
    <Card className="rounded-3xl border-slate-200 bg-white py-0 shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
      <CardHeader className="px-6 pb-0 pt-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="order-2 flex flex-wrap items-center gap-2 lg:order-1">
            {chart.series.map((serie) => (
              <Badge key={serie.id} variant="outline" className="gap-2 rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: serie.color }} />
                {serie.label}
              </Badge>
            ))}
          </div>
          <div className="order-1 flex shrink-0 items-center justify-end gap-3 lg:order-2">
            <CardTitle className="text-2xl font-black tracking-tight text-[#24164f]">{chart.title}</CardTitle>
            <span className="flex size-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sky-500 shadow-sm">
              <ShoppingCart className="size-5" />
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-4">
        {loading ? (
          <Skeleton className="h-[315px] rounded-2xl" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-dashed border-slate-200 bg-white pharmacy-scrollbar">
            <div className="min-w-[920px] px-2 py-2">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" role="img" aria-label={chart.title}>
                {ticks.map((tick) => {
                  const y = PY + UW - (tick / max) * UW
                  return (
                    <g key={tick}>
                      <line x1={PX} x2={W - PX / 2} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                      <text x={PX - 16} y={y + 4} textAnchor="end" fontSize="12" fill="#475569" fontWeight="700">
                        {fmt(tick)}
                      </text>
                    </g>
                  )
                })}

                <line x1={PX} x2={PX} y1={PY} y2={H - PY} stroke="#e2e8f0" />
                <line x1={PX} x2={W - PX / 2} y1={H - PY} y2={H - PY} stroke="#cbd5e1" />

                {paths.map((serie) => (
                  <g key={serie.id}>
                    <path d={serie.path} fill="none" stroke={serie.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    {serie.values.map((v, i) => {
                      const step = (W - PX * 2) / Math.max(1, serie.values.length - 1)
                      const x = PX + step * i
                      const y = PY + UW - (v / max) * UW
                      return (
                        <circle key={`${uid}-${serie.id}-${i}`} cx={x} cy={y} r={serie.id === "all" ? 4 : 3} fill={serie.color} stroke="white" strokeWidth="1.5">
                          <title>{`${chart.labels[i]} - ${serie.label}: ${v.toLocaleString("en-US")} ج.م`}</title>
                        </circle>
                      )
                    })}
                  </g>
                ))}

                {chart.labels.map((label, i) => {
                  if (i % everyNth !== 0) return null
                  const step = (W - PX * 2) / Math.max(1, chart.labels.length - 1)
                  const x = PX + step * i
                  return (
                    <text key={label} x={x} y={H - 8} textAnchor="end" fontSize="11" fill="#334155" transform={`rotate(-45 ${x} ${H - 8})`}>
                      {label}
                    </text>
                  )
                })}

                <text x="18" y={H / 2} transform={`rotate(-90 18 ${H / 2})`} textAnchor="middle" fontSize="12" fill="#334155" fontWeight="700">
                  {chart.unitLabel}
                </text>

                {isEmpty ? (
                  <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="18" fill="#94a3b8" fontWeight="900">
                    لا توجد مبيعات في هذه الفترة
                  </text>
                ) : null}
              </svg>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
