"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ErrorBoundaryProps {
  children: ReactNode
  fallbackTitle?: string
  fallbackDescription?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="mx-auto flex min-h-[300px] max-w-lg items-center justify-center px-4 py-10">
          <Card className="w-full rounded-2xl border-red-200 bg-red-50 text-right shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-start gap-2 text-lg font-black text-red-900">
                <AlertTriangle className="size-5" />
                {this.props.fallbackTitle ?? "حدث خطأ غير متوقع"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm font-semibold leading-7 text-red-800">
              <p>{this.props.fallbackDescription ?? "حدث خطأ أثناء تحميل هذا المكون. يرجى المحاولة مرة أخرى."}</p>
              {this.state.error?.message ? (
                <p className="rounded-lg bg-red-100 p-3 text-xs text-red-700">{this.state.error.message}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="rounded-xl font-black"
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.reload()
                }}
              >
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallbackTitle="حدث خطأ في الصفحة"
      fallbackDescription="حدث خطأ أثناء عرض هذه الصفحة. يرجى المحاولة مرة أخرى أو العودة للصفحة الرئيسية."
    >
      {children}
    </ErrorBoundary>
  )
}
