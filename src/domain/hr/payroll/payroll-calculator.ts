import { AttendanceStatus, LeaveType } from "@/domain/hr/hr-types"
import { Money } from "@/domain/shared/decimal-value"
import {
  SalaryType,
  type EmployeePayrollInput,
  type PayrollLineCalculation,
  type PayrollPolicy,
} from "./payroll-types"

export const DEFAULT_PAYROLL_POLICY: PayrollPolicy = Object.freeze({
  // JavaScript UTC weekday: Sunday=0 ... Friday=5. Egypt's common rest day is Friday.
  defaultWorkingWeekdays: Object.freeze([0, 1, 2, 3, 4, 6]),
  standardDailyHours: 8,
  paidLeaveTypes: Object.freeze([LeaveType.Annual, LeaveType.Sick, LeaveType.Emergency]),
})

export class PayrollPeriod {
  readonly startDate: string
  readonly endDate: string

  private constructor(readonly value: string) {
    const [year, month] = value.split("-").map(Number)
    this.startDate = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`
    const end = new Date(Date.UTC(year, month, 0))
    this.endDate = end.toISOString().slice(0, 10)
  }

  static parse(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
      throw new Error("فترة الرواتب يجب أن تكون بالشكل YYYY-MM")
    }
    return new PayrollPeriod(normalized)
  }

  dates() {
    const dates: string[] = []
    const cursor = new Date(`${this.startDate}T00:00:00Z`)
    const end = new Date(`${this.endDate}T00:00:00Z`)
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return dates
  }
}

export class PayrollCalculator {
  constructor(private readonly policy: PayrollPolicy = DEFAULT_PAYROLL_POLICY) {}

  calculate(periodInput: PayrollPeriod | string, input: EmployeePayrollInput): PayrollLineCalculation {
    const period = typeof periodInput === "string" ? PayrollPeriod.parse(periodInput) : periodInput
    const salaryRate = Money.nonNegative(input.salaryRate)
    const workingWeekdays = normalizeWeekdays(input.scheduledWeekdays, this.policy.defaultWorkingWeekdays)
    const fullPeriodScheduledDates = period.dates().filter((date) =>
      workingWeekdays.has(new Date(`${date}T00:00:00Z`).getUTCDay()),
    )
    const hireDate = normalizeEmploymentDate(input.hireDate)
    const employmentEndDate = normalizeEmploymentDate(input.employmentEndDate)
    const scheduledDates = fullPeriodScheduledDates.filter((date) => {
      if (hireDate && date < hireDate) return false
      if (employmentEndDate && date > employmentEndDate) return false
      return true
    })
    const scheduledSet = new Set(scheduledDates)

    const attendanceByDate = new Map(
      input.attendance
        .filter((record) => scheduledSet.has(record.dateKey))
        .map((record) => [record.dateKey, record] as const),
    )
    const leaveByDate = buildLeaveCalendar(input.approvedLeaves, scheduledSet)

    let payableDays = 0
    let absentDays = 0
    let paidLeaveDays = 0
    let unpaidLeaveDays = 0
    let workedHours = 0

    for (const date of scheduledDates) {
      const leaveType = leaveByDate.get(date)
      const attendance = attendanceByDate.get(date)

      if (leaveType === LeaveType.Unpaid) {
        unpaidLeaveDays += 1
        continue
      }
      if (leaveType && this.policy.paidLeaveTypes.includes(leaveType)) {
        paidLeaveDays += 1
        payableDays += 1
        continue
      }
      if (!attendance) continue

      if (attendance.status === AttendanceStatus.Absent) {
        absentDays += 1
        continue
      }
      payableDays += 1
      workedHours += Math.max(0, Number(attendance.hoursWorked ?? 0))
    }

    const scheduledDays = scheduledDates.length
    const fullPeriodScheduledDays = fullPeriodScheduledDates.length
    const deductibleDays = absentDays + unpaidLeaveDays
    const paidLeaveHours = paidLeaveDays * this.policy.standardDailyHours
    let regularPay = Money.zero()
    let absenceDeduction = Money.zero()

    switch (input.salaryType) {
      case SalaryType.Monthly: {
        if (fullPeriodScheduledDays > 0) {
          const dailyRate = salaryRate.divide(fullPeriodScheduledDays)
          regularPay = dailyRate.multiply(scheduledDays)
          absenceDeduction = dailyRate.multiply(deductibleDays)
        }
        break
      }
      case SalaryType.Weekly: {
        const workDaysPerWeek = Math.max(1, workingWeekdays.size)
        regularPay = salaryRate.divide(workDaysPerWeek).multiply(scheduledDays)
        absenceDeduction = salaryRate.divide(workDaysPerWeek).multiply(deductibleDays)
        break
      }
      case SalaryType.Daily:
        regularPay = salaryRate.multiply(payableDays)
        break
      case SalaryType.Hourly:
        regularPay = salaryRate.multiply(workedHours + paidLeaveHours)
        break
      default:
        regularPay = Money.zero()
    }

    const deductions = absenceDeduction.min(regularPay)
    const additions = Money.zero()
    const gross = regularPay.add(additions)
    const net = gross.subtract(deductions).max(0)

    return {
      employee_id: input.employeeId,
      employee_name: input.employeeName,
      position: input.position,
      salary_type: input.salaryType,
      salary_rate: salaryRate.toNumber(),
      scheduled_days: scheduledDays,
      payable_days: payableDays,
      absent_days: absentDays,
      paid_leave_days: paidLeaveDays,
      unpaid_leave_days: unpaidLeaveDays,
      worked_hours: roundHours(workedHours),
      regular_pay: regularPay.toNumber(),
      additions: additions.toNumber(),
      deductions: deductions.toNumber(),
      gross_salary: gross.toNumber(),
      net_salary: net.toNumber(),
      calculation_details: {
        period: period.value,
        hire_date: hireDate,
        employment_end_date: employmentEndDate,
        full_period_scheduled_days: fullPeriodScheduledDays,
        employment_scheduled_days: scheduledDays,
        prorated_for_employment_period: scheduledDays !== fullPeriodScheduledDays,
        working_weekdays: [...workingWeekdays],
        standard_daily_hours: this.policy.standardDailyHours,
        absence_deduction: deductions.toNumber(),
        paid_leave_hours: paidLeaveHours,
        compensated_hours: roundHours(workedHours + paidLeaveHours),
        explicit_attendance_records: attendanceByDate.size,
        approved_leave_days: leaveByDate.size,
      },
    }
  }
}

function normalizeWeekdays(value: readonly number[] | undefined, fallback: readonly number[]) {
  const normalized = (value?.length ? value : fallback)
    .map((day) => Math.trunc(Number(day)))
    .filter((day) => day >= 0 && day <= 6)
  return new Set(normalized.length ? normalized : fallback)
}

function buildLeaveCalendar(leaves: readonly EmployeePayrollInput["approvedLeaves"][number][], scheduledDates: Set<string>) {
  const calendar = new Map<string, LeaveType>()
  for (const leave of leaves) {
    const cursor = new Date(`${leave.startDate}T00:00:00Z`)
    const end = new Date(`${leave.endDate}T00:00:00Z`)
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10)
      if (scheduledDates.has(date)) calendar.set(date, leave.type)
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return calendar
}

function roundHours(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100
}

function normalizeEmploymentDate(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.slice(0, 10) : ""
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}
