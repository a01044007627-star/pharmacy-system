import { NextResponse } from "next/server"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { HrRepository } from "@/lib/server/hr-repository"
import {
  operationalErrorResponse,
  RouteHttpError,
  TenantRequestContext,
} from "@/lib/server/tenant-request-context"

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

export async function GET(request: Request) {
  try {
    const tenant = await TenantRequestContext.from(request, {
      permission: "hr:read",
      forbiddenMessage: "ليست لديك صلاحية عرض الحضور",
    })
    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const records = await repository.listAttendance({
      dateKey: tenant.text("date") || undefined,
      employeeId: tenant.text("employee_id") || undefined,
      limit: tenant.integer("limit", 100, 10, 500),
    })

    return NextResponse.json({ records })
  } catch (error) {
    return operationalErrorResponse(error, "hr/attendance GET failed", "فشل تحميل الحضور")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تسجيل الحضور",
    })
    const employeeId = clean(body.employee_id)
    if (!employeeId) throw new RouteHttpError("اختر الموظف", 400, "EMPLOYEE_REQUIRED")

    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const action = clean(body.action) || "check-in"

    if (action === "check-out") {
      const record = await repository.checkOut(employeeId)
      await writeAuditLog(tenant.db, {
        pharmacyId: tenant.pharmacyId,
        branchId: tenant.branchId,
        actorId: tenant.actorId,
        eventType: "attendance.checked_out",
        source: "hr",
        description: "تم تسجيل انصراف الموظف",
        metadata: { employee_id: employeeId, attendance_id: record?.id, hours_worked: record?.hours_worked },
      })
      return NextResponse.json(record)
    }

    if (action !== "check-in") {
      throw new RouteHttpError("إجراء الحضور غير صالح", 400, "INVALID_ATTENDANCE_ACTION")
    }

    const record = await repository.checkIn({
      employeeId,
      notes: clean(body.notes) || null,
      status: clean(body.status) || null,
    })
    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: "attendance.checked_in",
      source: "hr",
      description: record?.status === "late" ? "تم تسجيل حضور متأخر" : "تم تسجيل حضور الموظف",
      metadata: { employee_id: employeeId, attendance_id: record?.id, status: record?.status },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "hr/attendance POST failed", "فشل تسجيل الحضور", 400)
  }
}
