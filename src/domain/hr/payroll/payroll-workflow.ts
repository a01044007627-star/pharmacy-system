import { StateMachine } from "@/domain/workflows/state-machine"
import { PayrollRunStatus } from "./payroll-types"

export const payrollRunWorkflow = new StateMachine<PayrollRunStatus>({
  [PayrollRunStatus.Draft]: [PayrollRunStatus.Approved, PayrollRunStatus.Cancelled],
  [PayrollRunStatus.Approved]: [PayrollRunStatus.Paid, PayrollRunStatus.Cancelled],
  [PayrollRunStatus.Paid]: [],
  [PayrollRunStatus.Cancelled]: [],
})
