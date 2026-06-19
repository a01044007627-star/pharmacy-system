"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Lock, LogOut, Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { loginUser } from "../services/auth-service"
import { loginSchema, getAuthErrorMessage, type LoginInput } from "@/lib/schemas"
import { ROUTES } from "@/config/routes"
import { AuthCard } from "./auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const router = useRouter()
  const { user: authUser, loading: authLoading, refreshAuth } = useAuth()
  const [isPending, startTransition] = useTransition()
  const [switchingAccount, setSwitchingAccount] = useState(false)

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  async function onSubmit(data: LoginInput) {
    try {
      await loginUser(data.email, data.password)
      await refreshAuth()
      toast.success("تم تسجيل الدخول بنجاح")
      startTransition(() => {
        router.replace(ROUTES.dashboard)
        router.refresh()
      })
    } catch (err) {
      toast.error(getAuthErrorMessage(err))
    }
  }


  if (authLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    )
  }

  if (authUser && !switchingAccount) {
    const displayName = authUser.user_metadata?.full_name ?? authUser.email
    return (
      <AuthCard className={className} showPolicy {...props}>
        <div className="flex flex-col gap-5">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-black leading-9 text-slate-950">هناك حساب مفتوح بالفعل</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              الحساب الحالي: {String(displayName ?? "")}. افتح لوحة التحكم أو بدّل الحساب.
            </p>
          </div>
          <Button type="button" className="w-full" onClick={() => startTransition(() => {
            router.replace(ROUTES.dashboard)
            router.refresh()
          })}>
            الدخول إلى لوحة التحكم
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={() => setSwitchingAccount(true)}>
            تسجيل دخول بحساب آخر
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={() => {
            toast.success("جاري تسجيل الخروج…")
            window.location.href = "/api/auth/logout"
          }}>
            <LogOut className="size-4 ml-1" />
            تسجيل الخروج
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard className={className} showPolicy {...props}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <div className="mx-auto mb-1 flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <Lock className="size-6" />
            </div>
            <h1 className="text-2xl font-black leading-9 text-slate-950">مرحباً بك مجدداً</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              سجل دخولك لمتابعة عمليات الصيدلية وإدارة الحسابات والمخزون.
            </p>
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>البريد الإلكتروني</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="أدخل بريدك الإلكتروني" autoComplete="email" dir="ltr" className="text-left" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>كلمة المرور</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" autoComplete="current-password" dir="ltr" className="text-left" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end">
            <Link href={ROUTES.forgotPassword} className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              هل نسيت كلمة المرور؟
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || isPending}>
            {form.formState.isSubmitting || isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            تسجيل الدخول
          </Button>

          <p className="text-center text-sm leading-6 text-muted-foreground">
            ليس لديك حساب؟{" "}
            <Link href={ROUTES.signup} className="font-medium text-brand hover:text-brand-hover underline underline-offset-4">
              إنشاء حسابك الآن
            </Link>
          </p>
        </form>
      </Form>
    </AuthCard>
  )
}
