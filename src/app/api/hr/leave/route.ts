import { NextResponse } from "next/server"
import { LeaveStatus } from "@/domain/hr/hr-types"
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
      forbiddenMessage: "ليست لديك صلاحية عرض الإجازات",
    })
    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const records = await repository.listLeave({
      status: tenant.text("status") || undefined,
      employeeId: tenant.text("employee_id") || undefined,
      limit: tenant.integer("limit", 100, 10, 500),
    })

    return NextResponse.json({ records })
  } catch (error) {
    return operationalErrorResponse(error, "hr/leave GET failed", "فشل تحميل الإجازات")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تسجيل الإجازات",
    })
    const employeeId = clean(body.employee_id)
    if (!employeeId) throw new RouteHttpError("اختر الموظف", 400, "EMPLOYEE_REQUIRED")

    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const record = await repository.createLeave({
      employeeId,
      type: clean(body.type),
      startDate: clean(body.start_date) || clean(body.date),
      endDate: clean(body.end_date),
      reason: clean(body.reason) || null,
    })

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: "leave.created",
      source: "hr",
      description: "تم إنشاء طلب إجازة جديد",
      metadata: { leave_id: record.id, employee_id: employeeId, start_date: record.start_date, end_date: record.end_date },
    })

    return NextResponse.json(record, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "hr/leave POST failed", "فشل تسجيل الإجازة", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تحديث الإجازات",
    })
    const id = clean(body.id)
    const status = clean(body.status)
    if (!id) throw new RouteHttpError("اختر طلب الإجازة", 400, "LEAVE_REQUIRED")
    if (!status) throw new RouteHttpError("اختر الحالة الجديدة", 400, "LEAVE_STATUS_REQUIRED")

    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const record = await repository.updateLeaveStatus({ id, status, actorId: tenant.actorId })

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: `leave.${record.status}`,
      source: "hr",
      description: leaveStatusDescription(record.status as LeaveStatus),
      metadata: { leave_id: record.id, employee_id: record.employee_id, status: record.status },
    })

    return NextResponse.json(record)
  } catch (error) {
    return operationalErrorResponse(error, "hr/leave PATCH failed", "فشل تحديث الإجازة", 400)
  }
}

function leaveStatusDescription(status: LeaveStatus) {
  if (status === LeaveStatus.Approved) return "تم اعتماد طلب الإجازة"
  if (status === LeaveStatus.Rejected) return "تم رفض طلب الإجازة"
  if (status === LeaveStatus.Cancelled) return "تم إلغاء طلب الإجازة"
  return "تم تحديث طلب الإجازة"
}
