"use client"

import type { ComponentType, ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Save, RotateCcw } from "lucide-react"

export function SettingsSectionCard({
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("rounded-2xl border-slate-200 bg-white shadow-sm", className)}>
      <CardHeader className="flex flex-row items-center gap-3 border-b border-slate-100 px-4 py-3">
        {Icon ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand/10 bg-brand-muted text-brand">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1 text-right">
          <CardTitle className="text-base font-black text-slate-900">{title}</CardTitle>
          {description ? <p className="mt-0.5 text-xs font-semibold text-slate-500">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  )
}

export function FormField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-1 items-start gap-2 sm:grid-cols-[200px_1fr] sm:gap-4", className)}>
      <span className="pt-1.5 text-xs font-black text-slate-700">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <FormField label={label}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-10 rounded-xl"
      />
    </FormField>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <FormField label={label}>
      <Select value={value} onValueChange={(v: string | null) => { if (v) onChange(v) }} disabled={disabled}>
        <SelectTrigger className="h-10 w-full rounded-xl text-right">
          <SelectValue placeholder={placeholder}>{options.find((option) => option.value === value)?.label ?? placeholder ?? "اختر"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function ToggleField({
  label,
  checked,
  onChange,
  description,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  description?: string
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right shadow-sm transition",
        disabled ? "opacity-70" : "hover:border-brand/30 hover:bg-brand-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="text-sm font-black text-slate-800">{label}</span>
        {description ? <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn("hidden text-[11px] font-black sm:inline", checked ? "text-brand" : "text-slate-400")}>
          {checked ? "مفعل" : "متوقف"}
        </span>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  return (
    <FormField label={label}>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="h-10 w-full rounded-xl text-left sm:w-32"
        dir="ltr"
      />
    </FormField>
  )
}

export function SettingsPageHeader({
  title,
  description,
  onSave,
  onReset,
  saving,
  canWrite,
}: {
  title: string
  description?: string
  onSave?: () => void
  onReset?: () => void
  saving?: boolean
  canWrite?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-right">
        <h1 className="text-lg font-black text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p> : null}
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
        {onReset ? (
          <Button variant="outline" size="sm" onClick={onReset} disabled={!canWrite || saving}>
            <RotateCcw className="size-4" />
            إعادة تعيين
          </Button>
        ) : null}
        {onSave ? (
          <Button variant="default" size="sm" onClick={onSave} disabled={!canWrite || saving}>
            <Save className="size-4" />
            {saving ? "جاري الحفظ…" : "حفظ"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
