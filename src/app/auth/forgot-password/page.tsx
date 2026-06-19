"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, ArrowRight, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROUTES } from "@/config/routes"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      toast.error("البريد الإلكتروني مطلوب")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(ROUTES.api.forgotPassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "فشل إرسال رابط إعادة تعيين كلمة المرور")
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ")
    }
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md">
      {sent ? (
        <Card className="py-0 border-slate-200 shadow-xl">
          <CardContent className="flex flex-col items-center justify-center gap-4 p-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-brand-muted text-brand">
              <CheckCircle2 className="size-7" />
            </span>
            <h1 className="text-xl font-black text-slate-900">تم إرسال الرابط</h1>
            <p className="text-xs font-bold text-slate-500 leading-relaxed max-w-sm">
              إذا كان البريد الإلكتروني مسجلاً في النظام، ستصل رسالة إلى{" "}
              <span className="text-slate-700 dir-ltr inline-block">{email}</span> تحتوي على رابط لإعادة تعيين كلمة المرور.
            </p>
            <Link href={ROUTES.login} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand hover:text-brand-hover">
              <ArrowRight className="size-4" />
              العودة لتسجيل الدخول
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0 border-slate-200 shadow-xl">
          <form onSubmit={handleSubmit}>
            <CardContent className="flex flex-col gap-5 p-8">
              <div className="text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                  <Mail className="size-6" />
                </div>
                <h1 className="text-xl font-black text-slate-900">نسيت كلمة المرور؟</h1>
                <p className="mt-1 text-xs font-bold text-slate-500">أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-black text-slate-700">البريد الإلكتروني</Label>
                <Input type="email" placeholder="أدخل بريدك الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "جاري الإرسال…" : "إرسال رابط إعادة التعيين"}
              </Button>

              <p className="text-center text-[11px] font-bold text-slate-400">
                تذكرت كلمة المرور؟{" "}
                <Link href={ROUTES.login} className="text-brand hover:text-brand-hover">تسجيل الدخول</Link>
              </p>
            </CardContent>
          </form>
        </Card>
      )}
    </div>
  )
}
