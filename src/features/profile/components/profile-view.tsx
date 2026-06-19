"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  Cloud,
  CloudOff,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  Store,
  UserCircle,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { useAuth } from "@/contexts/auth-context"
import { useNetwork } from "@/hooks/use-data-layer"
import { roleLabels } from "@/lib/auth/permission-metadata"
import { localDB } from "@/lib/sync/local-db"
import { cn } from "@/lib/utils"
import { ProfileImageUploader } from "./profile-image-uploader"

type ProfileRecord = {
  id?: string
  user_id?: string
  email?: string | null
  username?: string | null
  full_name?: string | null
  phone?: string | null
  avatar_url?: string | null
  global_role?: string | null
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

type ProfilePayload = {
  profile?: ProfileRecord | null
  user?: { id?: string; email?: string | null; metadata?: Record<string, unknown> }
  role?: string
  activePharmacy?: { id: string; name: string; legal_name?: string | null } | null
  activeBranch?: { id: string; name: string; code?: string | null } | null
  memberships?: Array<{
    id: string
    role: string
    pharmacy?: { id: string; name: string } | null
    branch?: { id: string; name: string } | null
  }>
  error?: string
}

type ProfileDraft = {
  username: string
  full_name: string
  phone: string
  avatar_url: string
}

const PROFILE_DOC_TYPE = "user_profile"

function profileDocId(userId?: string | null) {
  return `profile:${userId ?? "guest"}`
}

function readMetaString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === "string" ? value : ""
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  try {
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  } catch {
    return value
  }
}

function StatLine({ icon: Icon, label, value }: { icon: typeof UserCircle; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-black text-slate-700">
        <span className="grid size-8 place-items-center rounded-xl bg-white text-brand shadow-sm">
          <Icon className="size-4" />
        </span>
        {label}
      </div>
      <span className="min-w-0 truncate text-left text-sm font-bold text-slate-500" dir="auto">{value}</span>
    </div>
  )
}

export function ProfileView() {
  const auth = useAuth()
  const network = useNetwork()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [hasOfflineDraft, setHasOfflineDraft] = useState(false)

  const docId = useMemo(() => profileDocId(auth.user?.id), [auth.user?.id])

  const applyDraft = useCallback((draft: Partial<ProfileDraft>) => {
    setFullName(draft.full_name ?? "")
    setUsername(draft.username ?? "")
    setPhone(draft.phone ?? "")
    setAvatarUrl(draft.avatar_url ?? "")
  }, [])

  const buildDraft = useCallback((overrides?: Partial<ProfileDraft>): ProfileDraft => ({
    username: (overrides?.username ?? username).trim(),
    full_name: (overrides?.full_name ?? fullName).trim(),
    phone: (overrides?.phone ?? phone).trim(),
    avatar_url: (overrides?.avatar_url ?? avatarUrl).trim(),
  }), [avatarUrl, fullName, phone, username])

  const saveLocalDraft = useCallback(async (draft: ProfileDraft) => {
    await localDB.putDocument({
      id: docId,
      type: PROFILE_DOC_TYPE,
      data: draft,
      synced: false,
      updated_at: new Date().toISOString(),
    })
    await localDB.queueMutation({
      id: `${docId}:${Date.now()}`,
      table: "user_profiles",
      operation: "update",
      data: { user_id: auth.user?.id, ...draft },
      created_at: new Date().toISOString(),
    })
    setHasOfflineDraft(true)
  }, [auth.user?.id, docId])

  const load = useCallback(async () => {
    if (!auth.user?.id) return
    setLoading(true)
    try {
      const localDoc = await localDB.getDocument(docId)
      if (localDoc?.data) {
        applyDraft(localDoc.data as Partial<ProfileDraft>)
        setHasOfflineDraft(!localDoc.synced)
      }

      const response = await fetch("/api/profile", { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as ProfilePayload
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الملف الشخصي")

      setPayload(data)
      setProfile(data.profile ?? null)
      setEmail(data.profile?.email ?? data.user?.email ?? auth.user.email ?? "")

      if (!localDoc?.data || localDoc.synced) {
        applyDraft({
          username: data.profile?.username ?? readMetaString(data.user?.metadata, "username"),
          full_name: (data.profile?.full_name ?? readMetaString(data.user?.metadata, "full_name")) || auth.user.email?.split("@")[0] || "",
          phone: data.profile?.phone ?? readMetaString(data.user?.metadata, "phone"),
          avatar_url: data.profile?.avatar_url ?? readMetaString(data.user?.metadata, "avatar_url"),
        })
        await localDB.putDocument({
          id: docId,
          type: PROFILE_DOC_TYPE,
          data: {
            username: data.profile?.username ?? readMetaString(data.user?.metadata, "username"),
            full_name: (data.profile?.full_name ?? readMetaString(data.user?.metadata, "full_name")) || auth.user.email?.split("@")[0] || "",
            phone: data.profile?.phone ?? readMetaString(data.user?.metadata, "phone"),
            avatar_url: data.profile?.avatar_url ?? readMetaString(data.user?.metadata, "avatar_url"),
          },
          synced: true,
          updated_at: new Date().toISOString(),
        })
        setHasOfflineDraft(false)
      }
    } catch (error) {
      setEmail(auth.user.email ?? "")
      const localDoc = await localDB.getDocument(docId).catch(() => null)
      if (localDoc?.data) {
        applyDraft(localDoc.data as Partial<ProfileDraft>)
        setHasOfflineDraft(!localDoc.synced)
      } else {
        applyDraft({
          username: readMetaString(auth.user.user_metadata, "username"),
          full_name: (auth.profile?.full_name ?? readMetaString(auth.user.user_metadata, "full_name")) || auth.user.email?.split("@")[0] || "",
          phone: auth.profile?.phone ?? readMetaString(auth.user.user_metadata, "phone"),
          avatar_url: auth.profile?.avatar_url ?? readMetaString(auth.user.user_metadata, "avatar_url"),
        })
      }
      if (error instanceof Error) toast.warning(error.message)
    } finally {
      setLoading(false)
    }
  }, [applyDraft, auth.profile?.avatar_url, auth.profile?.full_name, auth.profile?.phone, auth.user, docId])

  useEffect(() => { void load() }, [load])

  const saveProfile = useCallback(async (overrides?: Partial<ProfileDraft>, successMessage = "تم حفظ الملف الشخصي") => {
    const draft = buildDraft(overrides)
    setSaving(true)
    try {
      if (!network.online) throw new Error("offline")
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const data = (await response.json().catch(() => ({}))) as ProfilePayload
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ الملف الشخصي")

      setProfile(data.profile ?? null)
      await localDB.putDocument({
        id: docId,
        type: PROFILE_DOC_TYPE,
        data: draft,
        synced: true,
        updated_at: new Date().toISOString(),
      })
      setHasOfflineDraft(false)
      toast.success(successMessage)
      await auth.refreshAuth({ pharmacyId: auth.activePharmacyId, branchId: auth.activeBranchId })
    } catch (error) {
      await saveLocalDraft(draft)
      toast.warning(error instanceof Error && error.message !== "offline" ? error.message : "تم حفظ نسخة أوفلاين وسيتم مزامنتها بعد الاتصال")
    } finally {
      setSaving(false)
    }
  }, [auth, buildDraft, docId, network.online, saveLocalDraft])

  const handleAvatarUploaded = useCallback((url: string) => {
    setAvatarUrl(url)
    void saveProfile({ avatar_url: url }, "تم رفع وحفظ الصورة الشخصية")
  }, [saveProfile])

  const syncDraft = async () => {
    if (!hasOfflineDraft) return
    await saveProfile(undefined, "تمت مزامنة الملف الشخصي")
  }

  const roleName = roleLabels[auth.role] ?? auth.role
  const membershipsCount = payload?.memberships?.length ?? auth.memberships.length

  return (
    <section dir="rtl" className="page-container block-gap-lg text-right">
      <DashboardPageHeader
        title="بيانات الحساب"
        subtitle="ملف شخصي حقيقي مرتبط بقاعدة البيانات مع رفع صورة عبر UploadThing ودعم مسودة أوفلاين عند انقطاع الاتصال."
        icon={UserCircle}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("gap-1 rounded-xl px-3 py-2 font-black", network.online ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700")}>
              {network.online ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
              {network.online ? "متصل" : "أوفلاين"}
            </Badge>
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void load()} disabled={loading || saving}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              تحديث
            </Button>
            <Button className="gap-2 rounded-xl" onClick={() => void saveProfile()} disabled={saving || loading}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              حفظ
            </Button>
          </div>
        )}
      />

      {hasOfflineDraft ? (
        <Alert className="rounded-2xl border-amber-100 bg-amber-50 text-amber-800">
          <CloudOff className="size-4" />
          <AlertTitle className="font-black">توجد تعديلات أوفلاين غير متزامنة</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-sm font-bold sm:flex-row sm:items-center sm:justify-between">
            <span>التعديلات محفوظة داخل قاعدة البيانات المحلية للجهاز. بعد رجوع الاتصال اضغط مزامنة.</span>
            <Button variant="outline" size="sm" className="w-fit rounded-xl border-amber-200" onClick={() => void syncDraft()} disabled={saving || !network.online}>مزامنة الآن</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card className="rounded-3xl border-slate-200 bg-brand/5 py-0 shadow-sm">
          <CardContent className="space-y-5 p-5">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="mx-auto size-32 rounded-[2rem]" />
                <Skeleton className="mx-auto h-6 w-40" />
                <Skeleton className="mx-auto h-4 w-52" />
              </div>
            ) : (
              <ProfileImageUploader
                name={fullName}
                email={email}
                avatarUrl={avatarUrl}
                disabled={saving}
                onChange={handleAvatarUploaded}
                onRemove={() => {
                  setAvatarUrl("")
                  void saveProfile({ avatar_url: "" }, "تم إزالة الصورة الشخصية")
                }}
              />
            )}

            <Separator />

            <div className="space-y-2">
              <StatLine icon={ShieldCheck} label="الدور" value={roleName} />
              <StatLine icon={Store} label="الصيدلية الحالية" value={auth.activePharmacy?.name ?? "كل الصيدليات"} />
              <StatLine icon={Building2} label="الفرع الحالي" value={auth.activeBranch?.name ?? "كل الفروع"} />
              <StatLine icon={BriefcaseBusiness} label="العضويات" value={`${membershipsCount} عضوية`} />
              <StatLine icon={CalendarClock} label="آخر تحديث" value={formatDate(profile?.updated_at)} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-3xl border-slate-200 py-0 shadow-sm">
            <CardHeader className="border-b border-slate-100 p-5">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-950">
                <BadgeCheck className="size-5 text-brand" />
                البيانات الأساسية
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label className="font-black">الاسم الكامل</Label>
                <Input className="h-12 rounded-2xl" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="اسم المستخدم" disabled={loading || saving} />
              </div>

              <div className="space-y-2">
                <Label className="font-black">اسم المستخدم</Label>
                <Input dir="ltr" className="h-12 rounded-2xl text-left" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="mostafa-falcon" disabled={loading || saving} />
              </div>

              <div className="space-y-2">
                <Label className="font-black">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input dir="ltr" className="h-12 rounded-2xl bg-slate-50 pl-10 text-left" value={email} disabled />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-black">الهاتف</Label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input dir="ltr" className="h-12 rounded-2xl pl-10 text-left" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="010..." disabled={loading || saving} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-black">رابط الصورة</Label>
                <Input dir="ltr" className="h-12 rounded-2xl text-left" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." disabled={loading || saving} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 py-0 shadow-sm">
            <CardHeader className="border-b border-slate-100 p-5">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-950">
                <KeyRound className="size-5 text-brand" />
                حالة الحساب والصلاحيات
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-emerald-700"><CheckCircle2 className="size-4" /> الحالة</div>
                <p className="mt-2 text-2xl font-black text-emerald-900">{profile?.is_active === false ? "موقوف" : "نشط"}</p>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-center gap-2 text-sm font-black text-blue-700"><ShieldCheck className="size-4" /> نوع الوصول</div>
                <p className="mt-2 text-2xl font-black text-blue-950">{auth.isDeveloper ? "مطور" : auth.isOwner ? "مالك" : roleName}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:col-span-2 xl:col-span-1">
                <div className="flex items-center gap-2 text-sm font-black text-slate-700"><Activity className="size-4" /> مصدر البيانات</div>
                <p className="mt-2 text-sm font-bold leading-7 text-slate-500">الأونلاين: Supabase / الأوفلاين: IndexedDB محلية للمسودة.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
