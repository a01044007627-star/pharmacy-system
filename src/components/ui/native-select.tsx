import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "./select"

export interface NativeSelectProps {
  className?: string
  selectClassName?: string
  size?: "sm" | "default"
  value?: string
  defaultValue?: string
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
  disabled?: boolean
  name?: string
  children?: React.ReactNode
}

function NativeSelect({
  className,
  selectClassName,
  size = "default",
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  children,
}: NativeSelectProps) {
  const handleValueChange = React.useCallback((val: string | null) => {
    if (onChange && val !== null) {
      const mockEvent = {
        target: {
          value: val,
          name: name || "",
        },
        currentTarget: {
          value: val,
          name: name || "",
        },
      } as React.ChangeEvent<HTMLSelectElement>
      onChange(mockEvent)
    }
  }, [onChange, name])

  return (
    <div
      className={cn(
        "group/native-select relative w-full min-w-0",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <Select
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-full", selectClassName)} size={size}>
          <SelectValue placeholder="اختر..." />
        </SelectTrigger>
        <SelectContent className="z-[9999]" align="start">
          {children}
        </SelectContent>
      </Select>
    </div>
  )
}

function NativeSelectOption({
  className,
  children,
  value,
  disabled,
}: React.ComponentProps<"option"> & { value?: string }) {
  return (
    <SelectItem
      value={value ?? ""}
      disabled={disabled}
      className={className}
    >
      {children}
    </SelectItem>
  )
}

function NativeSelectOptGroup({
  className,
  children,
  label,
}: React.ComponentProps<"optgroup">) {
  return (
    <SelectGroup className={className}>
      {label && <div className="px-2 py-1.5 text-xs font-black text-slate-400 text-right">{label}</div>}
      {children}
    </SelectGroup>
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
