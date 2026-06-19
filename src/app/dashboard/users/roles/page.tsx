"use client"

import { ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/contexts/auth-context"
import { getPermissions } from "@/lib/auth/permissions"
import { permissionGroups, permissionLabel, roleLabels } from "@/lib/auth/permission-metadata"
import type { MedicalRole } from "@/types"
import { LoadingState } from "@/components/shared/loading-state"
import { DashboardPageHeader } from "@/components/shared/page-ui"

const roles: MedicalRole[] = ["developer", "owner", "admin", "manager", "accountant", "pharmacist", "cashier", "technician", "worker", "viewer"]

export default function RolesPage() {
  const auth = useAuth()

  if (auth.loading) {
    return <LoadingState text="جاري تحميل الصلاحيات…" />
  }

  if (!auth.isDeveloper) {
    return (
      <section dir="rtl" className="page-container py-8 text-right">
        <Card className="rounded-3xl border-amber-100 bg-amber-50">
          <CardContent className="p-5 text-sm font-black leading-7 text-amber-700">
            صفحة مصفوفة كل الصلاحيات مخصصة للمطور فقط. صاحب الصيدلية يدير مستخدمي صيدليته من صفحة المستخدمين بدون الاطلاع على صلاحيات النظام العامة.
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section dir="rtl" className="page-container space-y-4 py-6 text-right">
      <DashboardPageHeader
        title="الأدوار والصلاحيات"
        subtitle="هذه الصفحة مرجع داخلي للمطور فقط. المستخدمون وأصحاب الصيدليات لا يظهر لهم جدول كل صلاحيات المنظومة."
        icon={ShieldCheck}
      />

      {permissionGroups.map((group) => (
        <Card key={group.id} className="overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-slate-100"><CardTitle className="text-base font-black">{group.label}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto pharmacy-scrollbar">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky right-0 z-10 bg-white text-right">الصلاحية</TableHead>
                    {roles.map((role) => <TableHead key={role} className="text-center">{roleLabels[role]}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.permissions.map((permission) => (
                    <TableRow key={permission}>
                      <TableCell className="sticky right-0 z-10 bg-white font-black">{permissionLabel(permission)}<div className="mt-0.5 text-[11px] text-slate-400" dir="ltr">{permission}</div></TableCell>
                      {roles.map((role) => {
                        const rolePermissions = getPermissions(role)
                        const allowed = rolePermissions.includes("system:all") || rolePermissions.includes(permission)
                        return <TableCell key={`${permission}-${role}`} className="text-center"><Badge className={allowed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}>{allowed ? "نعم" : "لا"}</Badge></TableCell>
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
