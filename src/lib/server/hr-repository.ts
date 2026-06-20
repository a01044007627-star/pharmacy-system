import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { OperationalRelationsRepository } from "@/lib/server/operational-relations-repository"
import { RouteHttpError } from "@/lib/server/tenant-request-context"

const LEAVE_TYPES = new Set(["annual", "sick", "emergency", "unpaid"])
const LEAVE_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"])

export class HrRepository {
  private readonly relations: OperationalRelationsRepository

  constructor(
    private readonly db: SupabaseClient,
    private readonly pharmacyId: string,
  ) {
    this.relations = new OperationalRelationsRepository(db, pharmacyId)
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

    const { data, error } = await this.db
      .from("pharmacy_attendance")
      .insert({
        pharmacy_id: this.pharmacyId,
        employee_id: params.employeeId,
        date_key: dateKey,
        check_in: now.toISOString(),
        status: params.status || "present",
        notes: params.notes || null,
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
      ? Math.max(0, Math.round(((now.getTime() - checkInTime) / 3_600_000) * 100) / 100)
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

    const type = LEAVE_TYPES.has(params.type ?? "") ? params.type as string : "annual"
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
        status: "pending",
      })
      .select("id,pharmacy_id,employee_id,type,start_date,end_date,days_used,reason,status,approved_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("تعذر إنشاء طلب الإجازة", 500, "LEAVE_CREATE_FAILED")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  async updateLeaveStatus(params: { id: string; status: string; actorId: string }) {
    if (!LEAVE_STATUSES.has(params.status)) {
      throw new RouteHttpError("حالة الإجازة غير صالحة", 400, "INVALID_LEAVE_STATUS")
    }

    const approvedBy = params.status === "approved" || params.status === "rejected" ? params.actorId : null
    const { data, error } = await this.db
      .from("pharmacy_leave")
      .update({ status: params.status, approved_by: approvedBy, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("pharmacy_id", this.pharmacyId)
      .select("id,pharmacy_id,employee_id,type,start_date,end_date,days_used,reason,status,approved_by,created_at,updated_at")
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("طلب الإجازة غير موجود", 404, "LEAVE_NOT_FOUND")

    const [record] = await this.relations.attachEmployees([data])
    return record
  }

  private async requireEmployee(employeeId: string) {
    const { data, error } = await this.db
      .from("pharmacy_employees")
      .select("id")
      .eq("id", employeeId)
      .eq("pharmacy_id", this.pharmacyId)
      .eq("is_active", true)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new RouteHttpError("الموظف غير موجود أو غير نشط", 404, "EMPLOYEE_NOT_FOUND")
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
