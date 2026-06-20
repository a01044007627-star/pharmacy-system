export type WorkflowTransitions<TStatus extends string> = Readonly<Record<TStatus, readonly TStatus[]>>

export class InvalidWorkflowTransitionError<TStatus extends string> extends Error {
  constructor(
    public readonly currentStatus: TStatus,
    public readonly requestedStatus: TStatus,
  ) {
    super(`الانتقال من الحالة «${currentStatus}» إلى «${requestedStatus}» غير مسموح`)
    this.name = "InvalidWorkflowTransitionError"
  }
}

export class StateMachine<TStatus extends string> {
  constructor(private readonly transitions: WorkflowTransitions<TStatus>) {}

  values() {
    return Object.keys(this.transitions) as TStatus[]
  }

  next(current: TStatus) {
    return [...(this.transitions[current] ?? [])]
  }

  selectableFrom(current: TStatus) {
    return [current, ...this.next(current)]
  }

  canTransition(current: TStatus, requested: TStatus) {
    return current === requested || this.transitions[current]?.includes(requested) === true
  }

  assertTransition(current: TStatus, requested: TStatus) {
    if (!this.canTransition(current, requested)) {
      throw new InvalidWorkflowTransitionError(current, requested)
    }
    return requested
  }
}
