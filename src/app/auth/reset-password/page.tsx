"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Lock, CheckCircle2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROUTES } from "@/config/routes"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes("type=recovery")) {
      setError("رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية")
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
      return
    }
    if (password !== confirmPassword) {
      setError("كلمة المرور غير متطابقة")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(ROUTES.api.updatePassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "فشل تحديث كلمة المرور")
      setDone(true)
      toast.success("تم تحديث كلمة المرور بنجاح")
      setTimeout(() => router.push(ROUTES.login), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
    setLoading(false)
  }

  if (error && !done) {
    return (
      <div className="w-full max-w-md">
        <Card className="py-0 border-slate-200 shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertCircle className="size-7" />
            </span>
            <h1 className="text-xl font-black text-slate-900">رابط غير صالح</h1>
            <p className="text-xs font-bold text-slate-500">{error}</p>
            <Link href={ROUTES.forgotPassword} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-brand">
              طلب رابط جديد
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (done) {
    return (
      <div className="w-full max-w-md">
        <Card className="py-0 border-slate-200 shadow-xl">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-brand-muted text-brand">
              <CheckCircle2 className="size-7" />
            </span>
            <h1 className="text-xl font-black text-slate-900">تم تغيير كلمة المرور</h1>
            <p className="text-xs font-bold text-slate-500">سيتم تحويلك إلى صفحة تسجيل الدخول…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <Card className="py-0 border-slate-200 shadow-xl">
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-5 p-8">
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                <Lock className="size-6" />
              </div>
              <h1 className="text-xl font-black text-slate-900">إعادة تعيين كلمة المرور</h1>
              <p className="mt-1 text-xs font-bold text-slate-500">أدخل كلمة المرور الجديدة</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-black text-slate-700">كلمة المرور الجديدة</Label>
              <Input type="password" placeholder="أدخل كلمة المرور الجديدة" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-black text-slate-700">تأكيد كلمة المرور</Label>
              <Input type="password" placeholder="أعد إدخال كلمة المرور" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>

            {error && <p className="text-[11px] font-bold text-destructive text-center">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "جاري التحديث…" : "تحديث كلمة المرور"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
