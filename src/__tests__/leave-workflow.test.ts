import { LeaveStatus } from "@/domain/hr/hr-types"
import { leaveWorkflow } from "@/domain/hr/leave-workflow"

describe("leave workflow", () => {
  it("allows review outcomes from pending", () => {
    expect(leaveWorkflow.canTransition(LeaveStatus.Pending, LeaveStatus.Approved)).toBe(true)
    expect(leaveWorkflow.canTransition(LeaveStatus.Pending, LeaveStatus.Rejected)).toBe(true)
    expect(leaveWorkflow.canTransition(LeaveStatus.Pending, LeaveStatus.Cancelled)).toBe(true)
  })

  it("allows cancelling approved leave but not reopening terminal states", () => {
    expect(leaveWorkflow.canTransition(LeaveStatus.Approved, LeaveStatus.Cancelled)).toBe(true)
    expect(leaveWorkflow.canTransition(LeaveStatus.Rejected, LeaveStatus.Pending)).toBe(false)
    expect(leaveWorkflow.canTransition(LeaveStatus.Cancelled, LeaveStatus.Approved)).toBe(false)
  })

  it("rejects illegal transitions", () => {
    expect(() => leaveWorkflow.assertTransition(LeaveStatus.Approved, LeaveStatus.Rejected)).toThrow()
  })
})
