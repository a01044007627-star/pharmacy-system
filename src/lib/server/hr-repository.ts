import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { AttendancePolicy, cairoMinutesOfDay } from "@/domain/hr/attendance-policy"
import { AttendanceStatus, LeaveStatus, LeaveType } from "@/domain/hr/hr-types"
import { leaveWorkflow } from "@/domain/hr/leave-workflow"
import { SalaryType } from "@/domain/hr/payroll/payroll-types"
import { Money } from "@/domain/shared/decimal-value"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { RouteHttpError } from "@/lib/server/tenant-request-context"

export class HrRepository {
  private readonly relations: OperationalRelationsRepository

  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {
    this.relations = new OperationalRelationsRepository(db, pharmacyId)
  }

  async listEmployees(params: { search?: string; active?: "active" | "inactive" | "all"; page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.trunc(params.page ?? 1))
    const pageSize = Math.min(100, Math.max(10, Math.trunc(params.pageSize ?? 25)))
    const offset = (page - 1) * pageSize
    let query = this.db
      .from("pharmacy_employees")
      .select("id,pharmacy_id,user_id,name,phone,email,position,salary,salary_type,hire_date,is_active,deactivated_at,deactivated_by,national_id,address,notes,created_at,updated_at", { count: "exact" })
      .eq("pharmacy_id", this.pharmacyId)
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1)

    const search = sanitizeSearch(params.search ?? "")
    if (search) query = query.or(`name.ilike.%${search}%,position.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`)
    if (params.active === "active") query = query.eq("is_active", true)
    if (params.active === "inactive") query = query.eq("is_active", false)

    const { data, error, count } = await query
    if (error) throw error
    const total = count ?? 0
    return {
      employees: data ?? [],
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async createEmployee(params: {
    name: string
    position: string
    phone?: string | null
    email?: string | null
    salary?: number | string | null
    salaryType?: string | null
    hireDate?: string | null
    nationalId?: string | null
    address?: string | null
    notes?: string | null
    linkedUserId?: string | null
    isActive?: boolean
  }) {
    const name = cleanText(params.name)
    const position = cleanText(params.position)
    if (!name) throw new RouteHttpError("اسم الموظف مطلوب", 400, "EMPLOYEE_NAME_REQUIRED")
    if (!position) throw new RouteHttpError("الوظيفة مطلوبة", 400, "EMPLOYEE_POSITION_REQUIRED")
    const email = normalizeEmail(params.email)
    const nationalId = cleanText(params.nationalId)
    await this.assertEmployeeIdentityAvailable({ email, nationalId })

    const { data, error } = await this.db
      .from("pharmacy_employees")
      .insert({
        pharmacy_id: this.pharmacyId,
        user_id: cleanText(params.linkedUserId) || null,
        name,
        phone: cleanText(params.phone) || null,
        email,
        position,
        salary: Money.nonNegative(params.salary).toNumber(),
        salary_type: asSalaryType(params.salaryType),
        hire_date: normalizeDate(cleanText(params.hireDate)) || cairoDateKey(new Date()),
        national_id: nationalId || null,
        address: cleanText(params.address) || null,
        notes: cleanText(params.notes) || null,
        is_active: params.isActive !== false,
      })
      .select("id,pharmacy_id,user_id,name,phone,email,position,salary,salary_type,hire_date,is_active,deactivated_at,deactivated_by,national_id,address,notes,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("تعذر إنشاء الموظف", 500, "EMPLOYEE_CREATE_FAILED")
    return data
  }

  async updateEmployee(params: {
    id: string
    name?: unknown
    position?: unknown
    phone?: unknown
    email?: unknown
    salary?: unknown
    salaryType?: unknown
    hireDate?: unknown
    nationalId?: unknown
    address?: unknown
    notes?: unknown
    isActive?: unknown
    actorId?: string | null
  }) {
    const existing = await this.requireEmployeeRecord(params.id, false)
    const updates: Record<string, unknown> = {}
    if (params.name !== undefined) {
      const name = cleanText(params.name)
      if (!name) throw new RouteHttpError("اسم الموظف مطلوب", 400, "EMPLOYEE_NAME_REQUIRED")
      updates.name = name
    }
    if (params.position !== undefined) {
      const position = cleanText(params.position)
      if (!position) throw new RouteHttpError("الوظيفة مطلوبة", 400, "EMPLOYEE_POSITION_REQUIRED")
      updates.position = position
    }
    if (params.phone !== undefined) updates.phone = cleanText(params.phone) || null
    if (params.email !== undefined) updates.email = normalizeEmail(params.email)
    if (params.salary !== undefined) updates.salary = Money.nonNegative(params.salary as number | string).toNumber()
    if (params.salaryType !== undefined) updates.salary_type = asSalaryType(params.salaryType)
    if (params.hireDate !== undefined) {
      const hireDate = normalizeDate(cleanText(params.hireDate))
      if (!hireDate) throw new RouteHttpError("تاريخ التوظيف غير صالح", 400, "INVALID_HIRE_DATE")
      updates.hire_date = hireDate
    }
    if (params.nationalId !== undefined) updates.national_id = cleanText(params.nationalId) || null
    if (params.address !== undefined) updates.address = cleanText(params.address) || null
    if (params.notes !== undefined) updates.notes = cleanText(params.notes) || null
    if (params.isActive !== undefined) {
      const isActive = params.isActive === true
      updates.is_active = isActive
      updates.deactivated_at = isActive ? null : new Date().toISOString()
      updates.deactivated_by = isActive ? null : cleanText(params.actorId) || null
    }

    const email = updates.email !== undefined ? updates.email as string | null : existing.email as string | null
    const nationalId = updates.national_id !== undefined ? updates.national_id as string | null : existing.national_id as string | null
    await this.assertEmployeeIdentityAvailable({ email, nationalId, excludeId: params.id })

    const { data, error } = await this.db
      .from("pharmacy_employees")
      .update(updates)
      .eq("id", params.id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,user_id,name,phone,email,position,salary,salary_type,hire_date,is_active,deactivated_at,deactivated_by,national_id,address,notes,created_at,updated_at")
      .maybeSingle()
    if (error) throw error
    if (!data) throw new RouteHttpError("الموظف غير موجود", 404, "EMPLOYEE_NOT_FOUND")
    return data
  }

  async deactivateEmployee(employeeId: string, actorId?: string | null) {
    await this.requireEmployeeRecord(employeeId, false)
    const { data, error } = await this.db
      .from("pharmacy_employees")
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivated_by: cleanText(actorId) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,name,is_active")
      .maybeSingle()
    if (error) throw error
    if (!data) throw new RouteHttpError("الموظف غير موجود", 404, "EMPLOYEE_NOT_FOUND")
    return data
  }

  async listAttendance(params: { dateKey?: string; employeeId?: string; limit?: number }) {
    let query = this.db
      .from("pharmacy_attendance")
      .select("id,pharmacy_id,employee_id,date_key,check_in,check_out,hours_worked,status,notes,created_at,updated_at")
      .eq("pharmacy_id", this.pharmacyId)
      .order("date_key", { ascending: false })
      .order("check_in", { ascending: false })
      .limit(params.limit ?? 100)

    if (params.dateKey) query = query.eq("date_key", params.dateKey)
    if (params.employeeId) query = query.eq("employee_id", params.employeeId)

    const { data, error } = await query
    if (error) throw error
    return this.relations.attachEmployees(data ?? [])
  }

  async checkIn(params: { employeeId: string; notes?: string | null; status?: string | null }) {
    await this.requireEmployee(params.employeeId)
    const now = new Date()
    const dateKey = cairoDateKey(now)
    const dayOfWeek = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
    const [shiftResult, graceResult] = await Promise.all([
      this.db
        .from("pharmacy_employee_shifts")
        .select("start_time")
        .eq("pharmacy_id", this.pharmacyId)
        .eq("employee_id", params.employeeId)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle(),
      this.db
        .from("pharmacy_settings")
        .select("value")
        .eq("pharmacy_id", this.pharmacyId)
        .eq("key", "hr.attendanceGraceMinutes")
        .maybeSingle(),
    ])
    if (shiftResult.error) throw shiftResult.error
    if (graceResult.error) throw graceResult.error

    const graceMinutes = normalizeGraceMinutes(graceResult.data?.value)
    const attendancePolicy = new AttendancePolicy(graceMinutes)
    const status = attendancePolicy.resolveStatus({
      arrivalMinute: cairoMinutesOfDay(now),
      shiftStart: shiftResult.data?.start_time ? String(shiftResult.data.start_time) : null,
      explicitStatus: asCheckInStatus(params.status),
    })

    const { data, error } = await this.db
      .from("pharmacy_attendance")
      .insert({
        pharmacy_id: this.pharmacyId,
        employee_id: params.employeeId,
        date_key: dateKey,
        check_in: now.toISOString(),
        status,
        notes: cleanText(params.notes) || null,
      })
      .select("id,pharmacy_id,employee_id,date_key,check_in,check_out,hours_worked,status,notes,created_at,updated_at")
      .maybeSingle()

    if (error?.code === "23505") {
      throw new RouteHttpError("تم تسجيل حضور الموظف اليوم بالفعل", 409, "ATTENDANCE_EXISTS")
    }
    if (error) throw error
    if (!data) throw new RouteHttpError("تعذر إنشاء سجل الحضور", 500, "ATTENDANCE_CREATE_FAILED")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  async checkOut(employeeId: string) {
    await this.requireEmployee(employeeId)
    const now = new Date()
    const dateKey = cairoDateKey(now)

    const { data: existing, error: existingError } = await this.db
      .from("pharmacy_attendance")
      .select("id,check_in,check_out")
      .eq("pharmacy_id", this.pharmacyId)
      .eq("employee_id", employeeId)
      .eq("date_key", dateKey)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) throw new RouteHttpError("لا يوجد تسجيل حضور للموظف اليوم", 404, "ATTENDANCE_NOT_FOUND")
    if (existing.check_out) throw new RouteHttpError("تم تسجيل انصراف الموظف مسبقًا", 409, "ATTENDANCE_CLOSED")

    const checkInTime = new Date(String(existing.check_in)).getTime()
    const hoursWorked = Number.isFinite(checkInTime)
      ? Math.min(36, Math.max(0, Math.round(((now.getTime() - checkInTime) / 3_600_000) * 100) / 100))
      : null

    const { data, error } = await this.db
      .from("pharmacy_attendance")
      .update({
        check_out: now.toISOString(),
        hours_worked: hoursWorked,
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,employee_id,date_key,check_in,check_out,hours_worked,status,notes,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("سجل الحضور غير موجود", 404, "ATTENDANCE_NOT_FOUND")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  async listLeave(params: { status?: string; employeeId?: string; limit?: number }) {
    let query = this.db
      .from("pharmacy_leave")
      .select("id,pharmacy_id,employee_id,type,start_date,end_date,days_used,reason,status,approved_by,created_at,updated_at")
      .eq("pharmacy_id", this.pharmacyId)
      .order("start_date", { ascending: false })
      .limit(params.limit ?? 100)

    if (params.status && params.status !== "all") query = query.eq("status", params.status)
    if (params.employeeId) query = query.eq("employee_id", params.employeeId)

    const { data, error } = await query
    if (error) throw error
    return this.relations.attachEmployees(data ?? [])
  }

  async createLeave(params: {
    employeeId: string
    type?: string
    startDate: string
    endDate?: string
    reason?: string | null
  }) {
    await this.requireEmployee(params.employeeId)

    const type = asLeaveType(params.type)
    const startDate = normalizeDate(params.startDate) || cairoDateKey(new Date())
    const endDate = normalizeDate(params.endDate ?? "") || startDate
    if (endDate < startDate) {
      throw new RouteHttpError("تاريخ نهاية الإجازة يجب ألا يسبق تاريخ البداية", 400, "INVALID_LEAVE_DATES")
    }

    const daysUsed = inclusiveDays(startDate, endDate)
    const { data, error } = await this.db
      .from("pharmacy_leave")
      .insert({
        pharmacy_id: this.pharmacyId,
        employee_id: params.employeeId,
        type,
        start_date: startDate,
        end_date: endDate,
        days_used: daysUsed,
        reason: params.reason || null,
        status: LeaveStatus.Pending,
      })
      .select("id,pharmacy_id,employee_id,type,start_date,end_date,days_used,reason,status,approved_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("تعذر إنشاء طلب الإجازة", 500, "LEAVE_CREATE_FAILED")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  async updateLeaveStatus(params: { id: string; status: string; actorId: string }) {
    const status = asLeaveStatus(params.status)
    const { data: existing, error: existingError } = await this.db
      .from("pharmacy_leave")
      .select("id,status")
      .eq("id", params.id)
      .eq("pharmacy_id", this.pharmacyId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw new RouteHttpError("طلب الإجازة غير موجود", 404, "LEAVE_NOT_FOUND")
    leaveWorkflow.assertTransition(existing.status as LeaveStatus, status)

    const approvedBy = status === LeaveStatus.Approved || status === LeaveStatus.Rejected ? params.actorId : null
    const { data, error } = await this.db
      .from("pharmacy_leave")
      .update({ status, approved_by: approvedBy, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,employee_id,type,start_date,end_date,days_used,reason,status,approved_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("طلب الإجازة غير موجود", 404, "LEAVE_NOT_FOUND")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  private async requireEmployeeRecord(employeeId: string, activeOnly = true) {
    let query = this.db
      .from("pharmacy_employees")
      .select("id,email,national_id,is_active")
      .eq("id", employeeId)
      .eq("pharmacy_id", this.pharmacyId)
    if (activeOnly) query = query.eq("is_active", true)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (!data) throw new RouteHttpError("الموظف غير موجود أو غير نشط", 404, "EMPLOYEE_NOT_FOUND")
    return data
  }

  private async assertEmployeeIdentityAvailable(params: { email?: string | null; nationalId?: string | null; excludeId?: string }) {
    const checks: Array<PromiseLike<{ data: unknown; error: unknown }>> = []
    if (params.email) {
      let query = this.db.from("pharmacy_employees").select("id").eq("pharmacy_id", this.pharmacyId).eq("email", params.email)
      if (params.excludeId) query = query.neq("id", params.excludeId)
      checks.push(query.limit(1).maybeSingle())
    }
    if (params.nationalId) {
      let query = this.db.from("pharmacy_employees").select("id").eq("pharmacy_id", this.pharmacyId).eq("national_id", params.nationalId)
      if (params.excludeId) query = query.neq("id", params.excludeId)
      checks.push(query.limit(1).maybeSingle())
    }
    const results = await Promise.all(checks)
    for (const result of results) if (result.error) throw result.error
    if (params.email && results[0]?.data) throw new RouteHttpError("البريد الإلكتروني مسجل لموظف آخر", 409, "EMPLOYEE_EMAIL_EXISTS")
    const nationalResult = params.email ? results[1] : results[0]
    if (params.nationalId && nationalResult?.data) throw new RouteHttpError("الرقم القومي مسجل لموظف آخر", 409, "EMPLOYEE_NATIONAL_ID_EXISTS")
  }

  private async requireEmployee(employeeId: string) {
    await this.requireEmployeeRecord(employeeId, true)
  }
}

function cairoDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function normalizeDate(value: string) {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim())
  return match ? match[0] : ""
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1)
}
function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value).toLowerCase()
  if (!email) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RouteHttpError("البريد الإلكتروني غير صالح", 400, "INVALID_EMPLOYEE_EMAIL")
  }
  return email
}

function sanitizeSearch(value: string) {
  return value.replace(/[,%.()'"]/g, " ").replace(/\s+/g, " ").trim()
}

function asSalaryType(value: unknown) {
  return Object.values(SalaryType).includes(value as SalaryType) ? value as SalaryType : SalaryType.Monthly
}

function asAttendanceStatus(value: unknown) {
  return Object.values(AttendanceStatus).includes(value as AttendanceStatus) ? value as AttendanceStatus : AttendanceStatus.Present
}

function asCheckInStatus(value: unknown) {
  const status = asAttendanceStatus(value)
  return status === AttendanceStatus.Late || status === AttendanceStatus.Excused ? status : null
}

function normalizeGraceMinutes(value: unknown) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.min(180, Math.max(0, parsed)) : 15
}

function asLeaveType(value: unknown) {
  return Object.values(LeaveType).includes(value as LeaveType) ? value as LeaveType : LeaveType.Annual
}

function asLeaveStatus(value: unknown) {
  if (!Object.values(LeaveStatus).includes(value as LeaveStatus)) {
    throw new RouteHttpError("حالة الإجازة غير صالحة", 400, "INVALID_LEAVE_STATUS")
  }
  return value as LeaveStatus
}

