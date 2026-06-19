"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Edit,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Store,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { getPermissions, isAssignablePharmacyPermission, type Permission } from "@/lib/auth/permissions"
import { permissionGroups, permissionLabel, roleLabels } from "@/lib/auth/permission-metadata"
import { cn } from "@/lib/utils"
import type { MedicalRole } from "@/types"
import type { PharmacyUser, UserFormValues, UserStatusFilter } from "@/features/users/types"
import {
  assignableUserRoles,
  baseRolePermissions,
  makeInitialUserValues,
  normalizedUserEmail,
  normalizedUserName,
  normalizedUserPhone,
  permissionSet,
} from "@/features/users/lib/users-helpers"

type PharmacyOption = { id: string; name: string; legal_name?: string | null; status?: string | null }

type UsersApiResponse = {
  users?: PharmacyUser[]
  user?: PharmacyUser
  error?: string
}

type UserDialogState =
  | { mode: "create"; user: null }
  | { mode: "edit"; user: PharmacyUser }
  | null

const assignablePermissionGroups = permissionGroups
  .map((group) => ({
    ...group,
    permissions: group.permissions.filter(isAssignablePharmacyPermission),
  }))
  .filter((group) => group.permissions.length > 0)

function buildUserPayload(values: UserFormValues, mode: "create" | "edit") {
  return {
    ...(mode === "edit" ? { user_id: values.user_id } : values.user_id ? { user_id: values.user_id } : {}),
    email: values.email.trim() || null,
    password: values.password.trim() || undefined,
    full_name: values.full_name.trim() || null,
    phone: values.phone.trim() || null,
    title: values.title.trim() || null,
    role: values.role,
    branch_id: values.branch_id || null,
    is_active: values.is_active,
    permissions: values.permissions,
    denied_permissions: values.denied_permissions,
  }
}

function statusBadge(isActive: boolean) {
  return isActive ? (
    <Badge className="bg-emerald-100 text-emerald-700">نشط</Badge>
  ) : (
    <Badge className="bg-rose-100 text-rose-700">موقوف</Badge>
  )
}

function roleBadge(role: MedicalRole) {
  return <Badge variant="outline" className="border-brand/20 bg-brand/5 font-black text-brand">{roleLabels[role] ?? role}</Badge>
}

function permissionCountLabel(count: number) {
  if (count === 0) return "بدون صلاحيات إضافية"
  return `${count.toLocaleString("ar-EG")} صلاحية إضافية`
}

function UserFormDialog({
  state,
  open,
  onOpenChange,
  onSubmit,
  saving,
  branches,
}: {
  state: UserDialogState
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: UserFormValues, mode: "create" | "edit") => Promise<void>
  saving: boolean
  branches: Array<{ id: string; name: string; code?: string | null }>
}) {
  const mode = state?.mode ?? "create"
  const [values, setValues] = useState<UserFormValues>(() => makeInitialUserValues(state?.user ?? null))

  useEffect(() => {
    if (open) setValues(makeInitialUserValues(state?.user ?? null))
  }, [open, state])

  const basePermissions = useMemo(() => permissionSet(baseRolePermissions(values.role)), [values.role])
  const selectedPermissions = useMemo(() => permissionSet(values.permissions), [values.permissions])
  const selectedDeniedPermissions = useMemo(() => permissionSet(values.denied_permissions), [values.denied_permissions])
  const effectivePermissions = useMemo(() => getPermissions(values.role, values.permissions, values.denied_permissions), [values.denied_permissions, values.permissions, values.role])

  const togglePermission = (permission: Permission, checked: boolean) => {
    if (basePermissions.has(permission)) return
    setValues((current) => {
      const next = new Set(current.permissions)
      const denied = new Set(current.denied_permissions)
      if (checked) {
        next.add(permission)
        denied.delete(permission)
      } else {
        next.delete(permission)
      }
      return { ...current, permissions: Array.from(next), denied_permissions: Array.from(denied) }
    })
  }

  const toggleDeniedPermission = (permission: Permission, checked: boolean) => {
    setValues((current) => {
      const next = new Set(current.denied_permissions)
      const extra = new Set(current.permissions)
      if (checked) {
        next.add(permission)
        extra.delete(permission)
      } else {
        next.delete(permission)
      }
      return { ...current, denied_permissions: Array.from(next), permissions: Array.from(extra) }
    })
  }

  const submit = async () => {
    if (!values.full_name.trim() && !values.email.trim()) {
      toast.error("اكتب اسم المستخدم أو البريد الإلكتروني")
      return
    }
    if (mode === "create" && !values.user_id && !values.email.trim()) {
      toast.error("اكتب البريد الإلكتروني لإرسال دعوة، أو اكتب user_id لمستخدم موجود.")
      return
    }
    await onSubmit(values, mode)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] sm:max-w-6xl overflow-hidden rounded-3xl p-0 text-right">
        <DialogHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-slate-950">
            <Users className="size-5 text-brand" />
            {mode === "create" ? "إضافة مستخدم جديد" : "تعديل المستخدم والصلاحيات"}
          </DialogTitle>
          <DialogDescription className="font-bold text-slate-500">
            حدد بيانات المستخدم، الدور الأساسي، الفرع، والصلاحيات الإضافية داخل الصيدلية.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(92vh-154px)]">
          <div className="grid gap-5 p-5 lg:grid-cols-[380px_1fr]">
            <Card className="h-fit rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-black">بيانات الحساب</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mode === "edit" ? (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-500" dir="ltr">
                    {values.user_id}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="font-black">معرف مستخدم موجود اختياري</Label>
                    <Input
                      dir="ltr"
                      className="h-11 rounded-2xl text-left"
                      value={values.user_id ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, user_id: event.target.value.trim() || undefined }))}
                      placeholder="Supabase user id"
                    />
                    <p className="text-[11px] font-bold text-slate-400">اتركه فارغًا لو هتبعت دعوة بريدية أو هتنشئ مستخدم جديد.</p>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="space-y-1.5">
                    <Label className="font-black">الاسم</Label>
                    <Input className="h-11 rounded-2xl" value={values.full_name} onChange={(event) => setValues((current) => ({ ...current, full_name: event.target.value }))} placeholder="اسم المستخدم" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-black">البريد الإلكتروني</Label>
                    <Input dir="ltr" className="h-11 rounded-2xl text-left" type="email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} placeholder="user@example.com" />
                  </div>
                </div>

                {mode === "create" ? (
                  <div className="space-y-1.5">
                    <Label className="font-black">كلمة المرور اختيارية</Label>
                    <Input dir="ltr" className="h-11 rounded-2xl text-left" type="password" value={values.password} onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))} placeholder="اتركها فارغة لإرسال دعوة بالبريد" />
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="space-y-1.5">
                    <Label className="font-black">الهاتف</Label>
                    <Input dir="ltr" className="h-11 rounded-2xl text-left" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} placeholder="010..." />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-black">المسمى الوظيفي</Label>
                    <Input className="h-11 rounded-2xl" value={values.title} onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))} placeholder="مثال: كاشير الفترة الصباحية" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="space-y-1.5">
                    <Label className="font-black">الدور الأساسي</Label>
                    <NativeSelect value={values.role} onChange={(event) => setValues((current) => ({ ...current, role: event.target.value as MedicalRole, permissions: [], denied_permissions: [] }))}>
                      {assignableUserRoles.map((role) => (
                        <NativeSelectOption key={role} value={role}>{roleLabels[role]}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-black">الفرع</Label>
                    <NativeSelect value={values.branch_id ?? "all"} onChange={(event) => setValues((current) => ({ ...current, branch_id: event.target.value === "all" ? null : event.target.value }))}>
                      <NativeSelectOption value="all">كل الفروع</NativeSelectOption>
                      {branches.map((branch) => (
                        <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-black text-slate-800">حالة المستخدم</p>
                    <p className="text-xs font-bold text-slate-400">المستخدم الموقوف لا يدخل للمنظومة.</p>
                  </div>
                  <Switch checked={values.is_active} onCheckedChange={(checked) => setValues((current) => ({ ...current, is_active: Boolean(checked) }))} />
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-brand/10 bg-brand/5 p-3 text-center">
                  <div>
                    <p className="text-[11px] font-black text-slate-500">صلاحيات الدور</p>
                    <p className="text-lg font-black text-brand">{basePermissions.size.toLocaleString("ar-EG")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-slate-500">إضافية / ممنوعة</p>
                    <p className="text-lg font-black text-emerald-700">{values.permissions.length.toLocaleString("ar-EG")} / <span className="text-rose-600">{values.denied_permissions.length.toLocaleString("ar-EG")}</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base font-black">الصلاحيات الإضافية</CardTitle>
                    <p className="mt-1 text-xs font-bold text-slate-500">الصلاحيات الأساسية تأتي من الدور. فعّل فقط الصلاحيات الزائدة لهذا المستخدم.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => setValues((current) => ({ ...current, permissions: [] }))}>
                    تفريغ الإضافي
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {assignablePermissionGroups.map((group) => {
                  const groupBaseCount = group.permissions.filter((permission) => basePermissions.has(permission)).length
                  const groupExtraCount = group.permissions.filter((permission) => selectedPermissions.has(permission)).length
                  return (
                    <div key={group.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-xs">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black text-slate-900">{group.label}</div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="bg-slate-50 text-slate-500">أساسي {groupBaseCount.toLocaleString("ar-EG")}</Badge>
                          <Badge className="bg-emerald-100 text-emerald-700">إضافي {groupExtraCount.toLocaleString("ar-EG")}</Badge>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {group.permissions.map((permission) => {
                          const isBase = basePermissions.has(permission)
                          const isExtra = selectedPermissions.has(permission)
                          const checked = isBase || isExtra
                          return (
                            <label
                              key={permission}
                              className={cn(
                                "flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 transition",
                                checked ? "border-brand/20 bg-brand/5" : "border-slate-100 bg-slate-50/50 hover:bg-slate-50",
                                isBase && "cursor-default opacity-85",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={isBase}
                                onCheckedChange={(value) => togglePermission(permission, Boolean(value))}
                                className="mt-0.5"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-xs font-black text-slate-800">{permissionLabel(permission)}</span>
                                <span className="block truncate text-[10px] font-bold text-slate-400" dir="ltr">{permission}</span>
                                {isBase ? <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">من الدور</span> : null}
                                {selectedDeniedPermissions.has(permission) ? <span className="mt-1 mr-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">ممنوعة</span> : null}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-rose-100 bg-rose-50/35 shadow-sm lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base font-black text-rose-700"><XCircle className="size-4" /> صلاحيات ممنوعة لهذا المستخدم</CardTitle>
                    <p className="mt-1 text-xs font-bold text-rose-500">استخدمها لمنع صلاحية أساسية من الدور أو صلاحية إضافية عن مستخدم معين فقط.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => setValues((current) => ({ ...current, denied_permissions: [] }))}>
                    تفريغ الممنوع
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {assignablePermissionGroups.map((group) => {
                  const visiblePermissions = group.permissions.filter((permission) => basePermissions.has(permission) || selectedPermissions.has(permission))
                  if (visiblePermissions.length === 0) return null
                  const groupDeniedCount = visiblePermissions.filter((permission) => selectedDeniedPermissions.has(permission)).length
                  return (
                    <div key={`deny-${group.id}`} className="rounded-2xl border border-rose-100 bg-white p-3 shadow-xs">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black text-slate-900">{group.label}</div>
                        <Badge className="bg-rose-100 text-rose-700">ممنوع {groupDeniedCount.toLocaleString("ar-EG")}</Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {visiblePermissions.map((permission) => {
                          const checked = selectedDeniedPermissions.has(permission)
                          return (
                            <label key={`deny-${permission}`} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 transition", checked ? "border-rose-200 bg-rose-50" : "border-slate-100 bg-slate-50/50 hover:bg-slate-50")}>
                              <Checkbox checked={checked} onCheckedChange={(value) => toggleDeniedPermission(permission, Boolean(value))} className="mt-0.5" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-xs font-black text-slate-800">{permissionLabel(permission)}</span>
                                <span className="block truncate text-[10px] font-bold text-slate-400" dir="ltr">{permission}</span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter className="items-center justify-between gap-3 bg-white px-5 py-4 sm:flex-row-reverse">
          <div className="text-xs font-bold text-slate-500">
            إجمالي الصلاحيات الفعّالة: <span className="font-black text-brand">{effectivePermissions.includes("system:all") ? "كل الصلاحيات" : effectivePermissions.length.toLocaleString("ar-EG")}</span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
            <Button className="rounded-xl" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              حفظ المستخدم
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisableUserDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  user: PharmacyUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md rounded-3xl text-right">
        <DialogHeader>
          <div className="mb-2 grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertTriangle className="size-6" />
          </div>
          <DialogTitle className="text-lg font-black">إيقاف المستخدم؟</DialogTitle>
          <DialogDescription className="font-bold text-slate-500">
            سيتم إيقاف عضوية <span className="font-black text-slate-800">{user ? normalizedUserName(user) : "المستخدم"}</span> داخل هذه الصيدلية. يمكن إعادة تفعيله لاحقًا من التعديل.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={loading}>إلغاء</Button>
          <Button variant="destructive" className="rounded-xl" onClick={() => void onConfirm()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            إيقاف المستخدم
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UsersManagementView({ variant = "all" }: { variant?: "all" | "employees" }) {
  const auth = useAuth()
  const [users, setUsers] = useState<PharmacyUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogState, setDialogState] = useState<UserDialogState>(null)
  const [disableUser, setDisableUser] = useState<PharmacyUser | null>(null)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<MedicalRole | "all">("all")
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all")
  const [branchFilter, setBranchFilter] = useState("all")
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([])
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>(auth.activePharmacyId ?? (auth.isDeveloper ? "all" : ""))
  const [selectedBranches, setSelectedBranches] = useState<Array<{ id: string; name: string; code?: string | null }>>([])

  const canRead = auth.can("users:read") || auth.isDeveloper
  const canWrite = auth.can("users:write") || auth.isDeveloper || auth.isOwner
  const canDelete = auth.can("users:delete") || auth.isDeveloper || auth.isOwner
  const canViewPermissionMatrix = auth.isDeveloper
  const pharmacyId = auth.isDeveloper ? (selectedPharmacyId === "all" ? null : selectedPharmacyId) : auth.activePharmacyId
  const branches = useMemo(() => auth.isDeveloper ? selectedBranches : auth.branches.map((branch) => ({ id: branch.id, name: branch.name, code: branch.code })), [auth.branches, auth.isDeveloper, selectedBranches])
  const canMutateSelectedPharmacy = Boolean(pharmacyId)

  const loadPharmacies = useCallback(async () => {
    if (!auth.isDeveloper) return
    try {
      const response = await fetch("/api/pharmacies", { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as { pharmacies?: PharmacyOption[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الصيدليات")
      setPharmacies(data.pharmacies ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل الصيدليات")
      setPharmacies([])
    }
  }, [auth.isDeveloper])

  const loadBranches = useCallback(async (targetPharmacyId: string | null) => {
    if (!auth.isDeveloper || !targetPharmacyId) {
      setSelectedBranches([])
      return
    }
    try {
      const response = await fetch(`/api/pharmacies/${targetPharmacyId}/branches`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as { branches?: Array<{ id: string; name: string; code?: string | null }>; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل الفروع")
      setSelectedBranches(data.branches ?? [])
    } catch {
      setSelectedBranches([])
    }
  }, [auth.isDeveloper])

  const loadUsers = useCallback(async () => {
    if (!canRead) {
      setUsers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (auth.isDeveloper && selectedPharmacyId === "all") {
        const sourcePharmacies = pharmacies.length ? pharmacies : []
        if (sourcePharmacies.length === 0) {
          setUsers([])
          return
        }
        const responses = await Promise.all(sourcePharmacies.map(async (pharmacy) => {
          const response = await fetch(`/api/pharmacies/${pharmacy.id}/users`, { cache: "no-store" })
          const data = (await response.json().catch(() => ({}))) as UsersApiResponse
          if (!response.ok) return []
          return (data.users ?? []).map((user) => ({ ...user, pharmacy: { id: pharmacy.id, name: pharmacy.name, legal_name: pharmacy.legal_name } }))
        }))
        setUsers(responses.flat())
        return
      }

      if (!pharmacyId) {
        setUsers([])
        return
      }

      const response = await fetch(`/api/pharmacies/${pharmacyId}/users`, { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as UsersApiResponse
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المستخدمين")
      const pharmacy = pharmacies.find((item) => item.id === pharmacyId)
      setUsers((data.users ?? []).map((user) => ({ ...user, pharmacy: pharmacy ? { id: pharmacy.id, name: pharmacy.name, legal_name: pharmacy.legal_name } : user.pharmacy })))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المستخدمين")
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [auth.isDeveloper, canRead, pharmacies, pharmacyId, selectedPharmacyId])

  useEffect(() => {
    void loadPharmacies()
  }, [loadPharmacies])

  useEffect(() => {
    if (!auth.isDeveloper) return
    if (selectedPharmacyId !== "all") void loadBranches(selectedPharmacyId)
    else setSelectedBranches([])
  }, [auth.isDeveloper, loadBranches, selectedPharmacyId])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => {
      if (variant === "employees" && user.role === "viewer") return false
      if (roleFilter !== "all" && user.role !== roleFilter) return false
      if (statusFilter === "active" && !user.is_active) return false
      if (statusFilter === "inactive" && user.is_active) return false
      if (branchFilter === "null" && user.branch_id) return false
      if (branchFilter !== "all" && branchFilter !== "null" && (user.branch_id ?? "") !== branchFilter) return false
      if (!needle) return true
      return [normalizedUserName(user), normalizedUserEmail(user), normalizedUserPhone(user), user.title ?? "", user.user_id]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [branchFilter, query, roleFilter, statusFilter, users, variant])

  const activeCount = useMemo(() => users.filter((user) => user.is_active).length, [users])
  const branchScopedCount = useMemo(() => users.filter((user) => Boolean(user.branch_id)).length, [users])
  const extraPermissionsCount = useMemo(() => users.reduce((total, user) => total + (user.permissions?.length ?? 0), 0), [users])

  const saveUser = async (values: UserFormValues, mode: "create" | "edit") => {
    if (!pharmacyId) {
      toast.error("اختر صيدلية محددة قبل إضافة أو تعديل المستخدم")
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/pharmacies/${pharmacyId}/users`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildUserPayload(values, mode)),
      })
      const data = (await response.json().catch(() => ({}))) as UsersApiResponse
      if (!response.ok) throw new Error(data.error ?? "فشل حفظ المستخدم")
      toast.success(mode === "create" ? "تم إضافة المستخدم" : "تم تعديل المستخدم")
      setDialogState(null)
      await loadUsers()
      await auth.refreshAuth({ pharmacyId, branchId: auth.activeBranchId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حفظ المستخدم")
    } finally {
      setSaving(false)
    }
  }

  const disableSelectedUser = async () => {
    if (!pharmacyId || !disableUser) return
    setSaving(true)
    try {
      const response = await fetch(`/api/pharmacies/${pharmacyId}/users?user_id=${encodeURIComponent(disableUser.user_id)}`, { method: "DELETE" })
      const data = (await response.json().catch(() => ({}))) as UsersApiResponse
      if (!response.ok) throw new Error(data.error ?? "فشل إيقاف المستخدم")
      toast.success("تم إيقاف المستخدم")
      setDisableUser(null)
      await loadUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إيقاف المستخدم")
    } finally {
      setSaving(false)
    }
  }

  if (!canRead) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-amber-100 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-5 text-sm font-black text-amber-700">
            <Lock className="size-5" /> ليس لديك صلاحية عرض المستخدمين.
          </CardContent>
        </Card>
      </section>
    )
  }


  return (
    <section dir="rtl" className="page-container space-y-5 py-4 text-right sm:py-5">
      <div className="responsive-panel rounded-3xl">
        <div className="responsive-toolbar gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-black text-brand">
              <Users className="size-4" /> إدارة المستخدمين والصلاحيات
            </div>
            <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">المستخدمون</h1>
            <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-slate-500">
              إضافة وتعديل وإيقاف المستخدمين، ربطهم بالصيدلية أو فرع محدد، ومنح صلاحيات إضافية فوق صلاحيات الدور الأساسي.
            </p>
          </div>
          <div className="responsive-actions">
            {auth.isDeveloper ? (
              <NativeSelect
                className="w-full min-w-0 sm:min-w-[230px] sm:w-auto"
                value={selectedPharmacyId}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedPharmacyId(value)
                  setBranchFilter("all")
                  void auth.setActiveScope({ pharmacyId: value === "all" ? null : value, branchId: null })
                }}
              >
                <NativeSelectOption value="all">كل الصيدليات</NativeSelectOption>
                {pharmacies.map((pharmacy) => <NativeSelectOption key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</NativeSelectOption>)}
              </NativeSelect>
            ) : null}
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void loadUsers()} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث
            </Button>
            {auth.isDeveloper ? (
              <Link href="/dashboard/users/roles" className={buttonVariants({ variant: "outline", className: "gap-2 rounded-xl" })}>
                <ShieldCheck className="size-4" /> الأدوار والصلاحيات
              </Link>
            ) : null}
            <Button className="gap-2 rounded-xl" disabled={!canWrite || !canMutateSelectedPharmacy} onClick={() => setDialogState({ mode: "create", user: null })}>
              <Plus className="size-4" /> إضافة مستخدم
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-3xl border-slate-200"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">إجمالي المستخدمين</p><strong className="mt-1 block text-3xl font-black text-slate-950">{users.length.toLocaleString("ar-EG")}</strong></CardContent></Card>
        <Card className="rounded-3xl border-emerald-100 bg-emerald-50"><CardContent className="p-4"><p className="text-xs font-black text-emerald-700">نشط</p><strong className="mt-1 block text-3xl font-black text-emerald-700">{activeCount.toLocaleString("ar-EG")}</strong></CardContent></Card>
        <Card className="rounded-3xl border-sky-100 bg-sky-50"><CardContent className="p-4"><p className="text-xs font-black text-sky-700">مرتبط بفرع</p><strong className="mt-1 block text-3xl font-black text-sky-700">{branchScopedCount.toLocaleString("ar-EG")}</strong></CardContent></Card>
        <Card className="rounded-3xl border-violet-100 bg-violet-50"><CardContent className="p-4"><p className="text-xs font-black text-violet-700">صلاحيات إضافية</p><strong className="mt-1 block text-3xl font-black text-violet-700">{extraPermissionsCount.toLocaleString("ar-EG")}</strong></CardContent></Card>
      </div>

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_180px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="h-11 rounded-2xl pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم، البريد، الهاتف، المسمى أو معرف المستخدم..." />
            </div>
            <NativeSelect value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as MedicalRole | "all")}>
              <NativeSelectOption value="all">كل الأدوار</NativeSelectOption>
              {assignableUserRoles.map((role) => <NativeSelectOption key={role} value={role}>{roleLabels[role]}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}>
              <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
              <NativeSelectOption value="active">نشط فقط</NativeSelectOption>
              <NativeSelectOption value="inactive">موقوف فقط</NativeSelectOption>
            </NativeSelect>
            <NativeSelect value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <NativeSelectOption value="all">كل الفروع</NativeSelectOption>
              <NativeSelectOption value="null">كل الفروع فقط</NativeSelectOption>
              {branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base font-black">قائمة المستخدمين</CardTitle>
            <Badge variant="outline" className="w-fit bg-slate-50 font-black">{filteredUsers.length.toLocaleString("ar-EG")} نتيجة</Badge>
          </div>
        </CardHeader>
        <div className="min-w-0 overflow-auto pharmacy-scrollbar">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">المستخدم</TableHead>
                {auth.isDeveloper ? <TableHead className="text-right">الصيدلية</TableHead> : null}
                <TableHead className="text-right">الدور</TableHead>
                <TableHead className="text-right">الفرع</TableHead>
                <TableHead className="text-right">صلاحيات</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={auth.isDeveloper ? 7 : 6} className="h-32 text-center"><Loader2 className="mx-auto size-6 animate-spin text-brand" /></TableCell></TableRow>
              ) : null}
              {!loading && filteredUsers.length === 0 ? (
                <TableRow><TableCell colSpan={auth.isDeveloper ? 7 : 6} className="h-32 text-center text-sm font-bold text-slate-400">لا توجد نتائج مطابقة</TableCell></TableRow>
              ) : null}
              {!loading && filteredUsers.map((user) => {
                const isProtected = user.role === "owner" || user.role === "developer"
                const canEditUser = canWrite && (!isProtected || auth.isDeveloper)
                const canDeleteUser = canDelete && user.is_active && (!isProtected || auth.isDeveloper) && user.user_id !== auth.user?.id
                return (
                  <TableRow key={user.id} className="align-top">
                    <TableCell className="min-w-[260px]">
                      <div className="font-black text-slate-900">{normalizedUserName(user)}</div>
                      <div className="mt-0.5 text-xs font-bold text-slate-400" dir="ltr">{normalizedUserEmail(user) || user.user_id}</div>
                      {user.title ? <div className="mt-1 text-xs font-bold text-slate-500">{user.title}</div> : null}
                    </TableCell>
                    {auth.isDeveloper ? (
                      <TableCell>
                        <div className="flex items-center gap-2 font-black text-slate-800"><Store className="size-4 text-brand" /> {user.pharmacy?.name ?? "صيدلية محددة"}</div>
                        {user.pharmacy?.legal_name ? <div className="mt-1 text-xs font-bold text-slate-400">{user.pharmacy.legal_name}</div> : null}
                      </TableCell>
                    ) : null}
                    <TableCell>{roleBadge(user.role)}</TableCell>
                    <TableCell>
                      <div className="font-bold text-slate-700">{user.branch?.name ?? (user.branch_id ? "فرع محدد" : "كل الفروع")}</div>
                      {user.branch?.code ? <div className="text-xs text-slate-400" dir="ltr">{user.branch.code}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="font-black text-slate-700">{permissionCountLabel(user.permissions?.length ?? 0)}</div>
                      {(user.permissions?.length ?? 0) > 0 ? <div className="mt-1 text-xs font-bold text-slate-400">فوق صلاحيات الدور الأساسي</div> : null}
                      {(user.denied_permissions?.length ?? 0) > 0 ? <div className="mt-1 text-xs font-black text-rose-500">{user.denied_permissions.length.toLocaleString("ar-EG")} صلاحية ممنوعة</div> : null}
                    </TableCell>
                    <TableCell>{statusBadge(user.is_active)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="gap-1 rounded-xl" disabled={!canEditUser || (auth.isDeveloper && selectedPharmacyId === "all")} onClick={() => setDialogState({ mode: "edit", user })}>
                          <Edit className="size-3.5" /> تعديل
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50" disabled={!canDeleteUser || (auth.isDeveloper && selectedPharmacyId === "all")} onClick={() => setDisableUser(user)}>
                          <Trash2 className="size-3.5" /> إيقاف
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {canViewPermissionMatrix ? (
        <Card className="rounded-3xl border-brand/10 bg-brand/5">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-black text-slate-900">مصفوفة الأدوار والصلاحيات</div>
              <p className="text-sm font-bold text-slate-500">راجع الصلاحيات الأساسية لكل دور، والصلاحيات الإضافية تُضاف من شاشة تعديل المستخدم.</p>
            </div>
            <Link href="/dashboard/users/roles" className={buttonVariants({ variant: "default", className: "rounded-xl" })}>فتح المصفوفة</Link>
          </CardContent>
        </Card>
      ) : null}

      <UserFormDialog
        state={dialogState}
        open={Boolean(dialogState)}
        onOpenChange={(open) => !open && setDialogState(null)}
        onSubmit={saveUser}
        saving={saving}
        branches={branches}
      />
      <DisableUserDialog
        user={disableUser}
        open={Boolean(disableUser)}
        onOpenChange={(open) => !open && setDisableUser(null)}
        onConfirm={disableSelectedUser}
        loading={saving}
      />
    </section>
  )
}
