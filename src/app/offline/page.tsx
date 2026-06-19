"use client"

import { useEffect, useState } from "react"
import { Box, LayoutDashboard, RefreshCw, ShoppingCart, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const LAST_ROUTE_KEY = "pharmacy-last-dashboard-route"

const links = [
  { href: "/dashboard/sales/cashier", label: "فتح الكاشير", icon: ShoppingCart },
  { href: "/dashboard/items", label: "قائمة الأصناف", icon: Box },
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
]

export default function OfflinePage() {
  const [lastRoute, setLastRoute] = useState("/dashboard")
  useEffect(() => { setLastRoute(localStorage.getItem(LAST_ROUTE_KEY) || "/dashboard") }, [])

  function openDocument(href: string) {
    window.location.assign(href)
  }

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-right">
      <Card className="w-full max-w-xl rounded-[2rem] border-slate-200 shadow-xl">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><WifiOff className="size-8" /></div>
          <div>
            <h1 className="text-2xl font-black text-slate-950">العمل دون إنترنت</h1>
            <p className="mt-2 leading-7 text-slate-600">الخادم غير متاح حاليًا. افتح صفحة سبق تجهيزها على هذا الجهاز، وسيتم حفظ العمليات المدعومة للمزامنة عند عودة الاتصال.</p>
          </div>
          <Button className="h-12 w-full rounded-2xl font-black" onClick={() => openDocument(lastRoute)}>
            <RefreshCw className="size-4" /> فتح آخر صفحة مستخدمة
          </Button>
          <div className="grid gap-2 sm:grid-cols-3">
            {links.map(({ href, label, icon: Icon }) => (
              <button key={href} type="button" onClick={() => openDocument(href)} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 font-black text-slate-800 transition hover:border-blue-300 hover:bg-blue-50">
                <Icon className="size-5 text-blue-600" /> {label}
              </button>
            ))}
          </div>
          <p className="text-xs font-bold leading-6 text-slate-500">يلزم تجهيز الجهاز مرة واحدة وهو متصل من صفحة المزامنة. أول زيارة لأي جهاز لا يمكن أن تعمل أوفلاين قبل تنزيل ملفات وبيانات المنظومة.</p>
        </CardContent>
      </Card>
    </main>
  )
}
