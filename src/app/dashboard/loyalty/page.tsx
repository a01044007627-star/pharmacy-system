"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Gift, RefreshCw, Search, Star } from "lucide-react"
import { toast } from "sonner"
import { PageAccess } from "@/components/auth/page-access"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Balance = { id: string; current_balance: number; partner: { id: string; name: string; phone: string } | null }
type Transaction = { id: string; points: number; type: string; created_at: string; partner: { id: string; name: string } | null }

export default function LoyaltyPage() {
  const auth = useAuth()
  const [balances, setBalances] = useState<Balance[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<"balances" | "transactions">("balances")

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/loyalty?pharmacy_id=${auth.activePharmacyId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { balances?: Balance[]; transactions?: Transaction[] }
      if (!response.ok) throw new Error("فشل تحميل بيانات الولاء")
      setBalances(data.balances ?? [])
      setTransactions(data.transactions ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل بيانات الولاء")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  const filteredBalances = useMemo(() => {
    if (!query) return balances
    const q = query.toLowerCase()
    return balances.filter((b) => b.partner?.name?.toLowerCase().includes(q) || b.partner?.phone?.includes(q))
  }, [balances, query])

  const totalPoints = useMemo(() => balances.reduce((s, b) => s + Math.max(0, Number(b.current_balance || 0)), 0), [balances])

  return (
    <PageAccess permission="loyalty:read">
      <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
        <DashboardPageHeader title="برنامج الولاء" subtitle="نقاط الولاء وأرصدة العملاء." icon={Gift} actions={
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
        } />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي العملاء</p><p className="mt-2 text-xl font-black text-slate-950">{balances.length.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي النقاط</p><p className="mt-2 text-xl font-black text-brand">{totalPoints.toLocaleString("ar-EG")}</p></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">المعاملات</p><p className="mt-2 text-xl font-black text-amber-600">{transactions.length.toLocaleString("ar-EG")}</p></CardContent></Card>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-2 p-4 border-b border-slate-100">
            <Button variant={tab === "balances" ? "default" : "outline"} size="sm" className="rounded-xl" onClick={() => setTab("balances")}><Star className="size-4" /> الأرصدة</Button>
            <Button variant={tab === "transactions" ? "default" : "outline"} size="sm" className="rounded-xl" onClick={() => setTab("transactions")}><Gift className="size-4" /> المعاملات</Button>
            {tab === "balances" ? (
              <div className="relative mr-auto max-w-xs flex-1">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم أو هاتف العميل..." className="h-9 rounded-xl pr-9 font-bold" />
              </div>
            ) : null}
          </CardContent>
          {loading ? <SkeletonRows count={6} /> : tab === "balances" ? (
            filteredBalances.length === 0 ? (
              <EmptyState icon={Star} title="لا توجد أرصدة" description="لم يتم تسجيل نقاط ولاء بعد." />
            ) : (
              <Table className="min-w-[600px]">
                <TableHeader><TableRow>
                  <TableHead className="text-right">العميل</TableHead><TableHead className="text-right">الهاتف</TableHead><TableHead className="text-center">النقاط</TableHead>
                </TableRow></TableHeader>
                <TableBody>{filteredBalances.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black text-brand">{row.partner?.name ?? "—"}</TableCell>
                    <TableCell dir="ltr" className="text-left font-bold">{row.partner?.phone ?? "—"}</TableCell>
                    <TableCell className="text-center font-black">{Number(row.current_balance || 0).toLocaleString("ar-EG")}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )
          ) : (
            transactions.length === 0 ? (
              <EmptyState icon={Gift} title="لا توجد معاملات" description="لم يتم تسجيل معاملات ولاء بعد." />
            ) : (
              <Table className="min-w-[700px]">
                <TableHeader><TableRow>
                  <TableHead className="text-right">العميل</TableHead><TableHead className="text-center">النوع</TableHead><TableHead className="text-center">النقاط</TableHead><TableHead className="text-center">التاريخ</TableHead>
                </TableRow></TableHeader>
                <TableBody>{transactions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-black text-brand">{row.partner?.name ?? "—"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className={cn("font-black", row.type === "earn" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>{row.type === "earn" ? "إضافة" : "خصم"}</Badge></TableCell>
                    <TableCell className="text-center font-black">{Number(row.points || 0).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-center text-xs font-bold">{new Date(row.created_at).toLocaleDateString("ar-EG")}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )
          )}
        </Card>
      </section>
    </PageAccess>
  )
}
