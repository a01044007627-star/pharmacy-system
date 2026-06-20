import { NextResponse } from "next/server"
import {
  PayrollPaymentMethod,
  PayrollRunStatus,
} from "@/domain/hr/payroll/payroll-types"
import { payrollRunWorkflow } from "@/domain/hr/payroll/payroll-workflow"
import { Money } from "@/domain/shared/decimal-value"
import { writeAuditLog } from "@/lib/audit/audit-log"
import { scopeCan } from "@/lib/auth/server-permissions"
import { PayrollRepository } from "@/lib/server/payroll-repository"
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
      forbiddenMessage: "ليست لديك صلاحية عرض الرواتب",
    })
    const repository = new PayrollRepository(tenant.db, tenant.pharmacyId)
    const period = clean(tenant.url.searchParams.get("period")) || currentCairoPeriod()
    const [snapshot, runs] = await Promise.all([
      repository.getPeriodSnapshot(period),
      repository.listRuns({ limit: 18 }),
    ])

    return NextResponse.json({
      ...snapshot,
      runs,
      statuses: statusOptions(),
      payment_methods: paymentMethodOptions(),
      allowed_statuses: snapshot.run ? payrollRunWorkflow.next(snapshot.run.status) : [],
    })
  } catch (error) {
    return operationalErrorResponse(error, "hr/payroll GET failed", "فشل تحميل الرواتب")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية إنشاء كشوف الرواتب",
    })
    const repository = new PayrollRepository(tenant.db, tenant.pharmacyId)
    const period = clean(body.period) || currentCairoPeriod()
    const clientRequestId = clean(body.client_request_id) || crypto.randomUUID()
    const result = await repository.createRun({
      period,
      actorId: tenant.actorId,
      clientRequestId,
      notes: clean(body.notes) || null,
    })

    await writeAuditLog(tenant.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      actorId: tenant.actorId,
      eventType: result.duplicate ? "payroll.duplicate_generation_ignored" : "payroll.created",
      source: "hr",
      description: result.duplicate ? "تم تجاهل إعادة إنشاء كشف رواتب موجود" : `تم إنشاء كشف رواتب ${period}`,
      metadata: { period, run_id: result.run?.id, client_request_id: clientRequestId },
    })

    return NextResponse.json({ result }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    return operationalErrorResponse(error, "hr/payroll POST failed", "فشل إنشاء كشف الرواتب", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const tenant = await TenantRequestContext.forMutation(request, body, {
      permission: "hr:write",
      forbiddenMessage: "ليست لديك صلاحية تعديل كشوف الرواتب",
    })
    const repository = new PayrollRepository(tenant.db, tenant.pharmacyId)
    const action = clean(body.action)
    const runId = clean(body.run_id) || clean(body.id)
    if (!runId) throw new RouteHttpError("اختر كشف الرواتب", 400, "PAYROLL_RUN_REQUIRED")

    if (action === "update-line") {
      const lineId = clean(body.line_id)
      if (!lineId) throw new RouteHttpError("اختر الموظف داخل الكشف", 400, "PAYROLL_LINE_REQUIRED")
      const result = await repository.updateLine({
        runId,
        lineId,
        additions: Money.nonNegative(body.additions as number | string).toNumber(),
        deductions: Money.nonNegative(body.deductions as number | string).toNumber(),
        notes: clean(body.notes) || null,
        actorId: tenant.actorId,
      })
      await auditPayrollAction(tenant, "payroll.line_updated", "تم تعديل إضافات وخصومات موظف في كشف الرواتب", { run_id: runId, line_id: lineId })
      return NextResponse.json({ result })
    }

    if (action === "pay") {
      if (!scopeCan(tenant.scope, "financials:write")) {
        throw new RouteHttpError("صرف الرواتب يحتاج صلاحية الإدارة المالية", 403, "FINANCIAL_PERMISSION_REQUIRED")
      }
      const paymentMethod = asPaymentMethod(body.payment_method)
      const result = await repository.pay({
        runId,
        branchId: clean(body.branch_id) || tenant.branchId,
        paymentMethod,
        actorId: tenant.actorId,
      })
      await auditPayrollAction(tenant, result.duplicate ? "payroll.duplicate_payment_ignored" : "payroll.paid", result.duplicate ? "تم تجاهل إعادة صرف كشف رواتب مصروف مسبقًا" : "تم صرف كشف الرواتب وتسجيل القيد المالي", { run_id: runId, payment_method: paymentMethod })
      return NextResponse.json({ result })
    }

    const requestedStatus = action === "approve"
      ? PayrollRunStatus.Approved
      : action === "cancel"
        ? PayrollRunStatus.Cancelled
        : null
    if (!requestedStatus) throw new RouteHttpError("إجراء الرواتب غير صالح", 400, "INVALID_PAYROLL_ACTION")

    const result = await repository.transition({ runId, status: requestedStatus, actorId: tenant.actorId })
    await auditPayrollAction(
      tenant,
      requestedStatus === PayrollRunStatus.Approved ? "payroll.approved" : "payroll.cancelled",
      requestedStatus === PayrollRunStatus.Approved ? "تم اعتماد كشف الرواتب" : "تم إلغاء كشف الرواتب",
      { run_id: runId },
    )
    return NextResponse.json({ result })
  } catch (error) {
    return operationalErrorResponse(error, "hr/payroll PATCH failed", "فشل تحديث كشف الرواتب", 400)
  }
}

function asPaymentMethod(value: unknown) {
  return Object.values(PayrollPaymentMethod).includes(value as PayrollPaymentMethod)
    ? value as PayrollPaymentMethod
    : PayrollPaymentMethod.Cash
}

function currentCairoPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}`
}

function statusOptions() {
  return [
    { value: PayrollRunStatus.Draft, label: "مسودة" },
    { value: PayrollRunStatus.Approved, label: "معتمد" },
    { value: PayrollRunStatus.Paid, label: "مصروف" },
    { value: PayrollRunStatus.Cancelled, label: "ملغي" },
  ]
}

function paymentMethodOptions() {
  return [
    { value: PayrollPaymentMethod.Cash, label: "نقدي" },
    { value: PayrollPaymentMethod.Card, label: "بطاقة" },
    { value: PayrollPaymentMethod.Wallet, label: "محفظة" },
    { value: PayrollPaymentMethod.BankTransfer, label: "تحويل بنكي" },
  ]
}

async function auditPayrollAction(
  tenant: Awaited<ReturnType<typeof TenantRequestContext.forMutation>>,
  eventType: string,
  description: string,
  metadata: Record<string, unknown>,
) {
  await writeAuditLog(tenant.db, {
    pharmacyId: tenant.pharmacyId,
    branchId: tenant.branchId,
    actorId: tenant.actorId,
    eventType,
    source: "hr",
    description,
    metadata,
  })
}
