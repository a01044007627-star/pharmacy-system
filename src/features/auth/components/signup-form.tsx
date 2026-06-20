"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { ChevronRight, UserPlus, Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { signupUser } from "../services/auth-service"
import { signupSchema, getAuthErrorMessage, type SignupValues } from "@/lib/schemas"
import { ROUTES } from "@/config/routes"
import { AuthCard } from "./auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form"
import { currencies, timezones, ownerTitles } from "@/config/auth"

const stepOneFields: (keyof SignupValues)[] = [
  "projectName", "currency", "mobile", "country", "city", "timezone",
]

function SelectField({
  id, label, options, placeholder, value, error, onChange,
}: {
  id: string; label: string; options: { value: string; label: string }[]
  placeholder: string; value?: string; error?: string; onChange: (v: string | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-black text-slate-700">{label}</Label>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="w-full" data-invalid={!!error}>
          <SelectValue placeholder={placeholder}>{options.find((opt) => opt.value === value)?.label ?? placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-[11px] font-bold text-destructive">{error}</p> : null}
    </div>
  )
}

export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
  const router = useRouter()
  const { user: authUser, loading: authLoading, refreshAuth } = useAuth()
  const [step, setStep] = useState(0)
  const [isPending, startTransition] = useTransition()

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      projectName: "", currency: "EGP", mobile: "", country: "مصر",
      city: "", timezone: "Africa/Cairo", title: "", firstName: "", lastName: "",
      username: "", email: "", password: "", confirmPassword: "",
    },
    mode: "onTouched",
  })

  const { handleSubmit, setValue, trigger, control, formState: { errors, isSubmitting } } = form
  const watchCurrency = useWatch({ control, name: "currency" })
  const watchTimezone = useWatch({ control, name: "timezone" })
  const watchTitle = useWatch({ control, name: "title" })

  async function onNext() {
    const valid = await trigger(stepOneFields, { shouldFocus: true })
    if (valid) setStep(1)
  }

  async function onSubmit(data: SignupValues) {
    try {
      const displayName = [data.title, data.firstName, data.lastName].filter(Boolean).join(" ")
      const result = await signupUser(data.email, data.password, displayName, data.projectName, data.currency, {
        phone: data.mobile,
        country: data.country,
        city: data.city,
        timezone: data.timezone,
        username: data.username,
      })
      toast.success("تم إنشاء الحساب بنجاح")
      if (result.session) {
        await refreshAuth()
        startTransition(() => {
          router.replace(ROUTES.dashboard)
          router.refresh()
        })
      } else {
        startTransition(() => router.replace(ROUTES.login))
      }
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

  if (authUser) return null

  return (
    <AuthCard className={className} showPolicy {...props}>
      <Form {...form}>
        <form onSubmit={step > 0 ? handleSubmit(onSubmit) : undefined} className="flex flex-col gap-5">
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
            <div className="mx-auto mb-1 flex size-12 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <UserPlus className="size-6" />
            </div>
            <h1 className="text-2xl font-black leading-9 text-slate-950">إنشاء حساب صيدلية جديد</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              أدخل بيانات الصيدلية والحساب الإداري الرئيسي للبدء في تشغيل النظام.
            </p>
          </div>

          <div className="flex gap-2 px-1" dir="ltr">
            <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 0 ? "bg-brand" : "bg-muted"}`} />
            <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-brand" : "bg-muted"}`} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-bold text-zinc-500">
            <span className={step === 0 ? "text-brand" : ""}>بيانات الصيدلية</span>
            <span className="text-zinc-300">/</span>
            <span className={step === 1 ? "text-brand" : ""}>الحساب الإداري</span>
          </div>

          {step === 0 ? (
            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسم الصيدلية:*</FormLabel>
                    <FormControl><Input placeholder="مثال: صيدلية الشفاء" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="currency" label="العملة الرئيسية:*" placeholder="اختر العملة"
                  options={currencies} value={watchCurrency}
                  error={errors.currency?.message}
                  onChange={(v) => v && setValue("currency", v, { shouldDirty: true, shouldValidate: true })}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الدولة:*</FormLabel>
                      <FormControl><Input placeholder="أدخل الدولة" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>المدينة:*</FormLabel>
                      <FormControl><Input placeholder="أدخل المدينة" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mobile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>رقم الهاتف:</FormLabel>
                      <FormControl><Input type="tel" placeholder="01XXXXXXXXX" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <SelectField
                id="timezone" label="المنطقة الزمنية:*" placeholder="اختر المنطقة الزمنية"
                options={timezones} value={watchTimezone}
                error={errors.timezone?.message}
                onChange={(v) => v && setValue("timezone", v, { shouldDirty: true, shouldValidate: true })}
              />

              <Button type="button" onClick={onNext} className="w-full mt-2">
                التالي
                <ChevronRight className="mr-1 size-4" />
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[0.72fr_1fr_1fr]">
                <SelectField
                  id="title" label="اللقب:" placeholder="--"
                  options={ownerTitles} value={watchTitle}
                  error={errors.title?.message}
                  onChange={(v) => v && setValue("title", v, { shouldDirty: true })}
                />
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الاسم:*</FormLabel>
                      <FormControl><Input placeholder="أدخل اسمك" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>اسم العائلة:*</FormLabel>
                      <FormControl><Input placeholder="أدخل اسم العائلة" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسم المستخدم للدخول:*</FormLabel>
                    <FormControl><Input placeholder="أدخل اسم المستخدم" {...field} /></FormControl>
                    <FormDescription>كلمة واحدة بالإنجليزية</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>البريد الإلكتروني:*</FormLabel>
                    <FormControl><Input type="email" placeholder="أدخل بريدك الإلكتروني" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>كلمة المرور:*</FormLabel>
                      <FormControl><Input type="password" placeholder="أدخل كلمة المرور" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تأكيد كلمة المرور:*</FormLabel>
                      <FormControl><Input type="password" placeholder="أعد كتابة كلمة المرور" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setStep(0)} className="flex-1" disabled={isSubmitting || isPending}>
                  <ChevronRight className="ml-1 size-4" />
                  السابق
                </Button>
                <Button type="submit" className="flex-1" disabled={isSubmitting || isPending}>
                  {isSubmitting || isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  إنشاء الحساب
                </Button>
              </div>
            </div>
          )}

          <p className="text-center text-sm leading-6 text-muted-foreground">
            لديك حساب بالفعل؟{" "}
            <Link href={ROUTES.login} className="font-medium text-brand hover:text-brand-hover underline underline-offset-4">
              تسجيل الدخول الآن
            </Link>
          </p>
        </form>
      </Form>
    </AuthCard>
  )
}
