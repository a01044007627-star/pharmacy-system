import { AttendanceStatus, LeaveType } from "@/domain/hr/hr-types"
import { PayrollCalculator } from "@/domain/hr/payroll/payroll-calculator"
import { SalaryType } from "@/domain/hr/payroll/payroll-types"

const calculator = new PayrollCalculator({
  defaultWorkingWeekdays: [0, 1, 2, 3, 4, 6],
  standardDailyHours: 8,
  paidLeaveTypes: [LeaveType.Annual, LeaveType.Sick, LeaveType.Emergency],
})

describe("PayrollCalculator", () => {
  it("keeps monthly salary and deducts only explicit absence or unpaid leave", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-1",
      employeeName: "موظف",
      position: "صيدلي",
      hireDate: "2020-01-01",
      salaryType: SalaryType.Monthly,
      salaryRate: 2600,
      scheduledWeekdays: [0, 1, 2, 3, 4, 6],
      attendance: [
        { dateKey: "2026-06-01", status: AttendanceStatus.Present, hoursWorked: 8 },
        { dateKey: "2026-06-02", status: AttendanceStatus.Absent, hoursWorked: 0 },
      ],
      approvedLeaves: [
        { type: LeaveType.Annual, startDate: "2026-06-03", endDate: "2026-06-03" },
        { type: LeaveType.Unpaid, startDate: "2026-06-04", endDate: "2026-06-04" },
      ],
    })

    expect(line.scheduled_days).toBeGreaterThan(20)
    expect(line.payable_days).toBe(2)
    expect(line.absent_days).toBe(1)
    expect(line.paid_leave_days).toBe(1)
    expect(line.unpaid_leave_days).toBe(1)
    expect(line.net_salary).toBeLessThan(2600)
    expect(line.net_salary).toBeGreaterThan(0)
  })

  it("calculates hourly salary from actual hours", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-2",
      employeeName: "موظف ساعي",
      position: null,
      hireDate: null,
      salaryType: SalaryType.Hourly,
      salaryRate: 25,
      attendance: [
        { dateKey: "2026-06-01", status: AttendanceStatus.Present, hoursWorked: 7.5 },
        { dateKey: "2026-06-02", status: AttendanceStatus.Late, hoursWorked: 6.25 },
      ],
      approvedLeaves: [],
    })

    expect(line.worked_hours).toBe(13.75)
    expect(line.regular_pay).toBe(343.75)
    expect(line.net_salary).toBe(343.75)
  })

  it("pays standard hours for approved paid leave for hourly employees", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-hourly-leave",
      employeeName: "موظف ساعي بإجازة",
      position: null,
      hireDate: null,
      salaryType: SalaryType.Hourly,
      salaryRate: 25,
      attendance: [],
      approvedLeaves: [
        { type: LeaveType.Sick, startDate: "2026-06-01", endDate: "2026-06-01" },
      ],
    })

    expect(line.paid_leave_days).toBe(1)
    expect(line.regular_pay).toBe(200)
    expect(line.calculation_details.paid_leave_hours).toBe(8)
  })

  it("does not infer absence from a missing attendance record", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-3",
      employeeName: "موظف بدون بصمة",
      position: null,
      hireDate: null,
      salaryType: SalaryType.Monthly,
      salaryRate: 3000,
      attendance: [],
      approvedLeaves: [],
    })

    expect(line.absent_days).toBe(0)
    expect(line.deductions).toBe(0)
    expect(line.net_salary).toBe(3000)
  })

  it("prorates monthly salary for a mid-month hire", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-4",
      employeeName: "موظف جديد",
      position: "صيدلي",
      hireDate: "2026-06-16",
      salaryType: SalaryType.Monthly,
      salaryRate: 2600,
      attendance: [],
      approvedLeaves: [],
    })

    expect(line.scheduled_days).toBe(13)
    expect(line.regular_pay).toBe(1300)
    expect(line.net_salary).toBe(1300)
    expect(line.calculation_details.prorated_for_employment_period).toBe(true)
  })

  it("includes a deactivated employee only through the employment end date", () => {
    const line = calculator.calculate("2026-06", {
      employeeId: "employee-5",
      employeeName: "موظف غادر",
      position: "كاشير",
      hireDate: "2020-01-01",
      employmentEndDate: "2026-06-15",
      salaryType: SalaryType.Monthly,
      salaryRate: 2600,
      attendance: [],
      approvedLeaves: [],
    })

    expect(line.scheduled_days).toBe(13)
    expect(line.regular_pay).toBe(1300)
    expect(line.net_salary).toBe(1300)
  })
})
