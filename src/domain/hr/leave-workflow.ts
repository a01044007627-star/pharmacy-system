import { StateMachine } from "@/domain/workflows/state-machine"
import { LeaveStatus } from "./hr-types"

export const leaveWorkflow = new StateMachine<LeaveStatus>({
  [LeaveStatus.Pending]: [LeaveStatus.Approved, LeaveStatus.Rejected, LeaveStatus.Cancelled],
  [LeaveStatus.Approved]: [LeaveStatus.Cancelled],
  [LeaveStatus.Rejected]: [],
  [LeaveStatus.Cancelled]: [],
})
