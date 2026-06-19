"use client"

import { useReducer, useEffect, useRef, useCallback } from "react"
import type { CalcOp } from "../types"

const evalOp = (a: number, b: number, op: CalcOp): number => {
  switch (op) {
    case "+": return a + b
    case "-": return a - b
    case "×": return a * b
    case "÷": return b !== 0 ? a / b : NaN
    default: return b
  }
}

const formatNum = (n: number): string => {
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(10).replace(/\.?0+$/, "")
  return s.length > 12 ? n.toExponential(4) : s
}

interface State {
  display: string
  prev: number | null
  op: CalcOp
  wait: boolean
}

const init: State = { display: "0", prev: null, op: null, wait: false }

type Action =
  | { type: "DIGIT"; d: string }
  | { type: "DECIMAL" }
  | { type: "OP"; next: CalcOp }
  | { type: "EQUALS" }
  | { type: "CLEAR" }
  | { type: "BACKSPACE" }
  | { type: "NEGATE" }
  | { type: "PERCENT" }
  | { type: "SQRT" }
  | { type: "RECIP" }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "DIGIT": {
      const { d } = a
      return {
        ...s, wait: false,
        display: s.wait && s.display !== "0"
          ? d
          : s.display === "0" && d !== "."
            ? d
            : s.display + d,
      }
    }

    case "DECIMAL":
      return {
        ...s, wait: false,
        display: s.wait ? "0." : s.display.includes(".") ? s.display : s.display + ".",
      }

    case "OP": {
      const cur = parseFloat(s.display)
      if (s.prev === null)
        return { ...s, prev: cur, op: a.next, wait: true }
      if (s.op) {
        const r = evalOp(s.prev, cur, s.op)
        return isNaN(r)
          ? { display: "خطأ", prev: null, op: null, wait: true }
          : { display: String(r), prev: r, op: a.next, wait: true }
      }
      return { ...s, op: a.next, wait: true }
    }

    case "EQUALS": {
      if (s.prev === null || !s.op) return s
      const r = evalOp(s.prev, parseFloat(s.display), s.op)
      return isNaN(r)
        ? { display: "خطأ", prev: null, op: null, wait: true }
        : { display: formatNum(r), prev: null, op: null, wait: true }
    }

    case "CLEAR": return init
    case "BACKSPACE":
      return { ...s, display: s.display.length <= 1 ? "0" : s.display.slice(0, -1) }
    case "NEGATE":
      return { ...s, wait: false, display: s.display.startsWith("-") ? s.display.slice(1) : "-" + s.display }
    case "PERCENT":
      return { ...s, wait: false, display: String(parseFloat(s.display) / 100) }
    case "SQRT": {
      const cur = parseFloat(s.display)
      return cur < 0 ? { ...s, display: "خطأ" } : { ...s, wait: true, display: String(Math.sqrt(cur)) }
    }
    case "RECIP": {
      const cur = parseFloat(s.display)
      return cur === 0 ? { ...s, display: "خطأ" } : { ...s, wait: true, display: String(1 / cur) }
    }
    default: return s
  }
}

const opMap: Record<string, CalcOp> = {
  "+": "+", "-": "-", "*": "×", "x": "×", "/": "÷",
}

export function useCalculator(onResult?: (value: number) => void) {
  const [s, dispatch] = useReducer(reducer, init)

  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return

      let action: Action | null = null
      if (/^[0-9]$/.test(e.key)) action = { type: "DIGIT", d: e.key }
      else if (e.key === ".") action = { type: "DECIMAL" }
      else if (e.key === "Backspace") action = { type: "BACKSPACE" }
      else if (e.key === "Enter" || e.key === "=") { e.preventDefault(); action = { type: "EQUALS" } }
      else if (e.key === "%") action = { type: "PERCENT" }
      else if (e.key === "Escape" || e.key === "Delete") action = { type: "CLEAR" }
      else {
        const mapped = opMap[e.key]
        if (mapped) action = { type: "OP", next: mapped }
      }

      if (action) dispatch(action)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const prevOpRef = useRef(s.op)
  const prevPrevRef = useRef(s.prev)
  useEffect(() => {
    if (prevPrevRef.current !== null && prevOpRef.current !== null &&
        s.prev === null && s.op === null && s.wait && s.display !== "0" && s.display !== "خطأ") {
      onResultRef.current?.(parseFloat(s.display))
    }
    prevOpRef.current = s.op
    prevPrevRef.current = s.prev
  })

  const input = useCallback((d: string) => dispatch({ type: "DIGIT", d }), [])
  const decimal = useCallback(() => dispatch({ type: "DECIMAL" }), [])
  const clear = useCallback(() => dispatch({ type: "CLEAR" }), [])
  const backspace = useCallback(() => dispatch({ type: "BACKSPACE" }), [])
  const negate = useCallback(() => dispatch({ type: "NEGATE" }), [])
  const percent = useCallback(() => dispatch({ type: "PERCENT" }), [])
  const performOp = useCallback((next: CalcOp) => dispatch({ type: "OP", next }), [])
  const equals = useCallback(() => dispatch({ type: "EQUALS" }), [])
  const squareRoot = useCallback(() => dispatch({ type: "SQRT" }), [])
  const reciprocal = useCallback(() => dispatch({ type: "RECIP" }), [])

  return {
    display: s.display,
    op: s.op,
    input, decimal, clear, backspace, negate, percent, performOp, equals, squareRoot, reciprocal,
  }
}
