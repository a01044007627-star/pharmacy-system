"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface NavActionButtonProps {
  label: string
  icon: LucideIcon
  href?: string
  onClick?: () => void
  type?: "pill" | "icon" | "text"
  highlight?: boolean
  className?: string
}

export const navbarButtonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-slate-700 shadow-none transition hover:border-brand/30 hover:bg-brand-muted hover:text-brand"

export const navbarIconButtonClass =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50/80 text-slate-600 shadow-none transition hover:border-brand/30 hover:bg-brand-muted hover:text-brand"

export function NavActionButton({
  label, icon: Icon, href, onClick, type = "text", highlight = false, className,
}: NavActionButtonProps) {
  const content = (
    <>
      {type === "pill" ? <span className="leading-none text-[13px] font-black">{label}</span> : null}
      <Icon className="size-5" strokeWidth={2.2} />
    </>
  )

  const classes = cn(
    type === "pill" ? navbarButtonClass : navbarIconButtonClass,
    highlight && "border-brand/30 bg-brand-muted text-brand shadow-sm hover:bg-brand-subtle hover:text-brand-hover",
    className,
  )

  if (href) {
    return (
      <Link href={href} title={label} aria-label={label} className={classes}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={classes}>
      {content}
    </button>
  )
}
