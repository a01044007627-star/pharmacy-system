import { PayrollRunStatus } from "@/domain/hr/payroll/payroll-types"
import { payrollRunWorkflow } from "@/domain/hr/payroll/payroll-workflow"

describe("payroll workflow", () => {
  it("requires approval before payment", () => {
    expect(payrollRunWorkflow.canTransition(PayrollRunStatus.Draft, PayrollRunStatus.Paid)).toBe(false)
    expect(payrollRunWorkflow.canTransition(PayrollRunStatus.Draft, PayrollRunStatus.Approved)).toBe(true)
    expect(payrollRunWorkflow.canTransition(PayrollRunStatus.Approved, PayrollRunStatus.Paid)).toBe(true)
  })

  it("treats paid and cancelled runs as terminal", () => {
    expect(payrollRunWorkflow.next(PayrollRunStatus.Paid)).toEqual([])
    expect(payrollRunWorkflow.next(PayrollRunStatus.Cancelled)).toEqual([])
  })
})
