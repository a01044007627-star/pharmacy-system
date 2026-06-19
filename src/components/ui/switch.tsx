"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      dir="ltr"
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-slate-300 p-0.5 shadow-inner transition-all duration-200 outline-none",
        "focus-visible:ring-3 focus-visible:ring-brand/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "data-checked:bg-brand data-unchecked:bg-slate-300",
        "data-disabled:cursor-not-allowed data-disabled:opacity-55",
        size === "sm" ? "h-6 w-10" : "h-7 w-12",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 will-change-transform",
          size === "sm" ? "size-5 group-data-checked/switch:translate-x-4" : "size-6 group-data-checked/switch:translate-x-5",
          "group-data-unchecked/switch:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
