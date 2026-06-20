import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { AttendanceStatus, LeaveStatus, LeaveType } from "@/domain/hr/hr-types"
import { PayrollCalculator, PayrollPeriod } from "@/domain/hr/payroll/payroll-calculator"
import {
  PayrollPaymentMethod,
  PayrollRunStatus,
  SalaryType,
  type PayrollLineCalculation,
} from "@/domain/hr/payroll/payroll-types"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { RouteHttpError } from "@/lib/server/tenant-request-context"

export type PayrollRunRow = {
  id: string
  pharmacy_id: string
  branch_id: string | null
  period: string
  period_start: string
  period_end: string
  run_number: string
  status: PayrollRunStatus
  total_base: number
  total_additions: number
  total_deductions: number
  total_gross: number
  total_net: number
  payment_method: PayrollPaymentMethod | null
  notes: string | null
  approved_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  branch?: { id: string; name: string } | null
}

export type PayrollLineRow = PayrollLineCalculation & {
  id: string
  pharmacy_id: string
  run_id: string
  notes: string | null
  created_at: string
  updated_at: string
  employee?: { id: string; name: string; position?: string | null } | null
}

const RUN_SELECT = [
  "id", "pharmacy_id", "branch_id", "period", "period_start", "period_end", "run_number", "status",
  "total_base", "total_additions", "total_deductions", "total_gross", "total_net", "payment_method",
  "notes", "approved_at", "paid_at", "cancelled_at", "created_at", "updated_at",
].join(",")

const LINE_SELECT = [
  "id", "pharmacy_id", "run_id", "employee_id", "employee_name", "position", "salary_type", "salary_rate",
  "scheduled_days", "payable_days", "absent_days", "paid_leave_days", "unpaid_leave_days", "worked_hours",
  "regular_pay", "additions", "deductions", "gross_salary", "net_salary", "notes", "calculation_details",
  "created_at", "updated_at",
].join(",")

export class PayrollRepository {
  private readonly calculator = new PayrollCalculator()
  private readonly relations: OperationalRelationsRepository

  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {
    this.relations = new OperationalRelationsRepository(db, pharmacyId)
  }

  async listRuns(params: { period?: string; limit?: number } = {}) {
    let query = this.db
      .from("pharmacy_payroll_runs")
      .select(RUN_SELECT)
      .eq("pharmacy_id", this.pharmacyId)
      .order("period", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(params.limit ?? 18)

    if (params.period) query = query.eq("period", params.period)
    const { data, error } = await query
    if (error) throw error
    const rows = await this.relations.attachBranches((data ?? []) as unknown as PayrollRunRow[])
    return rows as PayrollRunRow[]
  }

  async getRun(runId: string) {
    const { data, error } = await this.db
      .from("pharmacy_payroll_runs")
      .select(RUN_SELECT)
      .eq("pharmacy_id", this.pharmacyId)
      .eq("id", runId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new RouteHttpError("كشف الرواتب غير موجود", 404, "PAYROLL_RUN_NOT_FOUND")
    const [run] = await this.relations.attachBranches([data as unknown as PayrollRunRow]) as PayrollRunRow[]
    return run
  }

  async getRunLines(runId: string) {
    const { data, error } = await this.db
      .from("pharmacy_payroll_lines")
      .select(LINE_SELECT)
      .eq("pharmacy_id", this.pharmacyId)
      .eq("run_id", runId)
      .order("employee_name")
    if (error) throw error
    const rows = await this.relations.attachEmployees((data ?? []) as unknown as PayrollLineRow[])
    return rows as PayrollLineRow[]
  }

  async getPeriodSnapshot(periodValue: string) {
    const period = PayrollPeriod.parse(periodValue)
    const runs = await this.listRuns({ period: period.value, limit: 1 })
    const run = runs[0] ?? null
    const lines = run ? await this.getRunLines(run.id) : []
    return { period: period.value, run, lines }
  }

  async calculateDraftLines(periodValue: string) {
    const period = PayrollPeriod.parse(periodValue)
    const [employeesResult, attendanceResult, leaveResult, shiftsResult] = await Promise.all([
      this.db
        .from("pharmacy_employees")
        .select("id,name,position,salary,salary_type,hire_date,is_active,deactivated_at")
        .eq("pharmacy_id", this.pharmacyId)
        .lte("hire_date", period.endDate)
        .or(`is_active.eq.true,deactivated_at.gte.${period.startDate}`)
        .order("name"),
      this.db
        .from("pharmacy_attendance")
        .select("employee_id,date_key,status,hours_worked")
        .eq("pharmacy_id", this.pharmacyId)
        .gte("date_key", period.startDate)
        .lte("date_key", period.endDate),
      this.db
        .from("pharmacy_leave")
        .select("employee_id,type,start_date,end_date,status")
        .eq("pharmacy_id", this.pharmacyId)
        .eq("status", LeaveStatus.Approved)
        .lte("start_date", period.endDate)
        .gte("end_date", period.startDate),
      this.db
        .from("pharmacy_employee_shifts")
        .select("employee_id,day_of_week")
        .eq("pharmacy_id", this.pharmacyId),
    ])

    for (const result of [employeesResult, attendanceResult, leaveResult, shiftsResult]) {
      if (result.error) throw result.error
    }

    const employees = employeesResult.data ?? []
    if (employees.length === 0) {
      throw new RouteHttpError("لا يوجد موظفون نشطون لإنشاء كشف الرواتب", 400, "NO_ACTIVE_EMPLOYEES")
    }

    const attendanceByEmployee = groupBy(attendanceResult.data ?? [], "employee_id")
    const leaveByEmployee = groupBy(leaveResult.data ?? [], "employee_id")
    const shiftsByEmployee = groupBy(shiftsResult.data ?? [], "employee_id")

    return employees.map((employee) => {
      const salaryType = asSalaryType(employee.salary_type)
      return this.calculator.calculate(period, {
        employeeId: String(employee.id),
        employeeName: String(employee.name),
        position: employee.position ? String(employee.position) : null,
        hireDate: employee.hire_date ? String(employee.hire_date) : null,
        employmentEndDate: employee.deactivated_at ? String(employee.deactivated_at).slice(0, 10) : null,
        salaryType,
        salaryRate: Math.max(0, Number(employee.salary ?? 0)),
        scheduledWeekdays: (shiftsByEmployee.get(String(employee.id)) ?? []).map((row) => Number(row.day_of_week)),
        attendance: (attendanceByEmployee.get(String(employee.id)) ?? []).map((row) => ({
          dateKey: String(row.date_key),
          status: asAttendanceStatus(row.status),
          hoursWorked: row.hours_worked == null ? null : Number(row.hours_worked),
        })),
        approvedLeaves: (leaveByEmployee.get(String(employee.id)) ?? []).map((row) => ({
          type: asLeaveType(row.type),
          startDate: String(row.start_date),
          endDate: String(row.end_date),
        })),
      })
    })
  }

  async createRun(params: {
    period: string
    actorId: string
    clientRequestId: string
    notes?: string | null
  }) {
    const period = PayrollPeriod.parse(params.period)
    const lines = await this.calculateDraftLines(period.value)
    const { data, error } = await this.db.rpc("create_payroll_run_v1", {
      p_pharmacy_id: this.pharmacyId,
      p_period: period.value,
      p_actor_id: params.actorId,
      p_client_request_id: params.clientRequestId,
      p_notes: params.notes ?? null,
      p_lines: lines,
    })
    if (error) throw error
    return data as { run?: PayrollRunRow; duplicate?: boolean }
  }

  async updateLine(params: {
    runId: string
    lineId: string
    additions: number
    deductions: number
    notes?: string | null
    actorId: string
  }) {
    const { data, error } = await this.db.rpc("update_payroll_line_v1", {
      p_pharmacy_id: this.pharmacyId,
      p_run_id: params.runId,
      p_line_id: params.lineId,
      p_additions: params.additions,
      p_deductions: params.deductions,
      p_notes: params.notes ?? null,
      p_actor_id: params.actorId,
    })
    if (error) throw error
    return data
  }

  async transition(params: { runId: string; status: PayrollRunStatus; actorId: string }) {
    const { data, error } = await this.db.rpc("transition_payroll_run_v1", {
      p_pharmacy_id: this.pharmacyId,
      p_run_id: params.runId,
      p_status: params.status,
      p_actor_id: params.actorId,
    })
    if (error) throw error
    return data
  }

  async pay(params: {
    runId: string
    branchId?: string | null
    paymentMethod: PayrollPaymentMethod
    actorId: string
  }) {
    const { data, error } = await this.db.rpc("pay_payroll_run_v1", {
      p_pharmacy_id: this.pharmacyId,
      p_run_id: params.runId,
      p_branch_id: params.branchId ?? null,
      p_payment_method: params.paymentMethod,
      p_actor_id: params.actorId,
    })
    if (error) throw error
    return data as { run?: PayrollRunRow; journal_entry_id?: string | null; duplicate?: boolean }
  }
}

function asSalaryType(value: unknown) {
  return Object.values(SalaryType).includes(value as SalaryType) ? value as SalaryType : SalaryType.Monthly
}

function groupBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const value = String(row[key] ?? "")
    if (!value) continue
    const bucket = grouped.get(value) ?? []
    bucket.push(row)
    grouped.set(value, bucket)
  }
  return grouped
}
function asAttendanceStatus(value: unknown) {
  return Object.values(AttendanceStatus).includes(value as AttendanceStatus)
    ? value as AttendanceStatus
    : AttendanceStatus.Present
}

function asLeaveType(value: unknown) {
  return Object.values(LeaveType).includes(value as LeaveType)
    ? value as LeaveType
    : LeaveType.Annual
}

