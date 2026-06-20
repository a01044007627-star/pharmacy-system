import { AttendanceStatus } from "./hr-types"

export type AttendanceDecisionInput = {
  arrivalMinute: number
  shiftStart?: string | null
  explicitStatus?: AttendanceStatus | null
}

/** Central policy for classifying a real check-in against the employee shift. */
export class AttendancePolicy {
  constructor(readonly graceMinutes = 15) {
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) {
      throw new Error("فترة السماح للحضور يجب أن تكون عددًا صحيحًا بين 0 و180 دقيقة")
    }
  }

  resolveStatus(input: AttendanceDecisionInput) {
    if (input.explicitStatus === AttendanceStatus.Excused) return AttendanceStatus.Excused
    if (input.explicitStatus === AttendanceStatus.Late) return AttendanceStatus.Late

    const shiftStartMinute = parseTimeToMinutes(input.shiftStart)
    if (shiftStartMinute === null) return AttendanceStatus.Present
    return input.arrivalMinute > shiftStartMinute + this.graceMinutes
      ? AttendanceStatus.Late
      : AttendanceStatus.Present
  }
}

export function parseTimeToMinutes(value: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? "")
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }
  return hours * 60 + minutes
}

export function cairoMinutesOfDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Number(values.hour) * 60 + Number(values.minute)
}
