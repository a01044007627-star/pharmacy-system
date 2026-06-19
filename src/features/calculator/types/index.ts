export type CalcOp = "+" | "-" | "×" | "÷" | null

export interface CalculatorState {
  display: string
  prev: number | null
  op: CalcOp
  wait: boolean
}

export interface CalculatorProps {
  className?: string
  onResult?: (value: number) => void
  autoFocus?: boolean
}
