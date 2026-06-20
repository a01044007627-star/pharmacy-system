import type { AttendanceStatus, LeaveType } from "@/domain/hr/hr-types"

export enum SalaryType {
  Monthly = "monthly",
  Weekly = "weekly",
  Daily = "daily",
  Hourly = "hourly",
}

export enum PayrollRunStatus {
  Draft = "draft",
  Approved = "approved",
  Paid = "paid",
  Cancelled = "cancelled",
}

export enum PayrollPaymentMethod {
  Cash = "cash",
  Card = "card",
  Wallet = "wallet",
  BankTransfer = "bank-transfer",
}

export type PayrollPolicy = {
  /** Working week used when an employee has no explicit shift schedule. */
  defaultWorkingWeekdays: readonly number[]
  standardDailyHours: number
  paidLeaveTypes: readonly LeaveType[]
}

export type PayrollAttendanceInput = {
  dateKey: string
  status: AttendanceStatus
  hoursWorked: number | null
}

export type PayrollLeaveInput = {
  type: LeaveType
  startDate: string
  endDate: string
}

export type EmployeePayrollInput = {
  employeeId: string
  employeeName: string
  position: string | null
  hireDate: string | null
  employmentEndDate?: string | null
  salaryType: SalaryType
  salaryRate: number
  scheduledWeekdays?: readonly number[]
  attendance: readonly PayrollAttendanceInput[]
  approvedLeaves: readonly PayrollLeaveInput[]
}

export type PayrollLineCalculation = {
  employee_id: string
  employee_name: string
  position: string | null
  salary_type: SalaryType
  salary_rate: number
  scheduled_days: number
  payable_days: number
  absent_days: number
  paid_leave_days: number
  unpaid_leave_days: number
  worked_hours: number
  regular_pay: number
  additions: number
  deductions: number
  gross_salary: number
  net_salary: number
  calculation_details: Record<string, unknown>
}
