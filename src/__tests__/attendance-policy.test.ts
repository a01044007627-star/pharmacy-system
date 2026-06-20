import { AttendancePolicy, parseTimeToMinutes } from "@/domain/hr/attendance-policy"
import { AttendanceStatus } from "@/domain/hr/hr-types"

describe("AttendancePolicy", () => {
  const policy = new AttendancePolicy(15)

  it("keeps arrivals inside the grace window present", () => {
    expect(policy.resolveStatus({ arrivalMinute: 9 * 60 + 15, shiftStart: "09:00" })).toBe(AttendanceStatus.Present)
  })

  it("marks arrivals after the grace window as late", () => {
    expect(policy.resolveStatus({ arrivalMinute: 9 * 60 + 16, shiftStart: "09:00" })).toBe(AttendanceStatus.Late)
  })

  it("supports an authorised excused override", () => {
    expect(policy.resolveStatus({ arrivalMinute: 11 * 60, shiftStart: "09:00", explicitStatus: AttendanceStatus.Excused })).toBe(AttendanceStatus.Excused)
  })

  it("parses valid shift times and rejects invalid values", () => {
    expect(parseTimeToMinutes("08:30:00")).toBe(510)
    expect(parseTimeToMinutes("25:00")).toBeNull()
  })
})
