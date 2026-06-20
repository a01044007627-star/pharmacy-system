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
      forbiddenMessage: "ليست لديك صلاحية عرض الموظفين",
    })
    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const { page, pageSize } = tenant.pagination(25, 100)
    const active = tenant.text("is_active")

    return NextResponse.json(await repository.listEmployees({
      search: tenant.search(),
      active: active === "active" || active === "inactive" ? active : "all",
      page,
      pageSize,
    }))
  } catch (error) {
    return operationalErrorResponse(error, "hr/employees GET failed", "فشل تحميل الموظفين")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية إضافة موظف",
    })
    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const employee = await repository.createEmployee({
      name: clean(body.name),
      position: clean(body.position),
      phone: clean(body.phone) || null,
      email: clean(body.email) || null,
      salary: body.salary as number | string | null,
      salaryType: clean(body.salary_type) || null,
      hireDate: clean(body.hire_date) || null,
      nationalId: clean(body.national_id) || null,
      address: clean(body.address) || null,
      notes: clean(body.notes) || null,
      isActive: body.is_active !== false,
    })

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: "employee.created",
      source: "hr",
      description: `تمت إضافة الموظف ${employee.name}`,
      metadata: { employee_id: employee.id },
    })

    return NextResponse.json(employee, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "hr/employees POST failed", "فشل إضافة الموظف", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تعديل الموظفين",
    })
    const id = clean(body.id)
    if (!id) throw new RouteHttpError("اختر الموظف", 400, "EMPLOYEE_REQUIRED")

    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const employee = await repository.updateEmployee({
      id,
      name: body.name,
      position: body.position,
      phone: body.phone,
      email: body.email,
      salary: body.salary,
      salaryType: body.salary_type,
      hireDate: body.hire_date,
      nationalId: body.national_id,
      address: body.address,
      notes: body.notes,
      isActive: body.is_active,
      actorId: tenant.actorId,
    })

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: "employee.updated",
      source: "hr",
      description: `تم تحديث بيانات الموظف ${employee.name}`,
      metadata: { employee_id: employee.id, is_active: employee.is_active },
    })

    return NextResponse.json(employee)
  } catch (error) {
    return operationalErrorResponse(error, "hr/employees PATCH failed", "فشل تحديث الموظف", 400)
  }
}

export async function DELETE(request: Request) {
  try {
    const tenant = await TenantRequestContext.from(request, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تعطيل الموظفين",
    })
    const id = clean(tenant.url.searchParams.get("id"))
    if (!id) throw new RouteHttpError("اختر الموظف", 400, "EMPLOYEE_REQUIRED")

    const repository = new HrRepository(tenant.db, tenant.pharmacyId)
    const employee = await repository.deactivateEmployee(id, tenant.actorId)

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: "employee.deactivated",
      source: "hr",
      description: `تم تعطيل الموظف ${employee.name} مع الاحتفاظ بسجلاته التاريخية`,
      metadata: { employee_id: employee.id },
    })

    return NextResponse.json({ ok: true, employee })
  } catch (error) {
    return operationalErrorResponse(error, "hr/employees DELETE failed", "فشل تعطيل الموظف", 400)
  }
}
