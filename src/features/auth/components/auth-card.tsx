"use client"

import Image from "next/image"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { BottomPolicy } from "./bottom-policy"

interface AuthCardProps {
  children: ReactNode
  showPolicy?: boolean
  className?: string
}

export function AuthCard({ children, showPolicy = false, className }: AuthCardProps) {
  return (
    <div className={cn("w-full max-w-4xl", className)}>
      <Card className="auth-legacy-card overflow-hidden border-slate-200 py-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.18fr_0.82fr]">
          <div className="min-w-0 p-5 sm:p-7 lg:p-8">
            {children}
          </div>

          <div className="auth-legacy-hero relative hidden min-h-[560px] overflow-hidden lg:flex flex-col items-center justify-center gap-4 p-8 text-center text-white">
            <div className="absolute inset-0">
              <Image
                src="/pharmacy-hero.png"
                alt="Logixa Pharmacy"
                fill
                priority
                sizes="(min-width: 1024px) 36vw"
                className="auth-legacy-image object-cover object-center"
              />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="auth-legacy-icon flex size-16 items-center justify-center rounded-2xl">
                <svg className="size-9" viewBox="0 0 24 24" role="img" aria-label="صيدلية">
                  <path fill="currentColor" d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5V3Z" />
                </svg>
              </div>
              <h2 className="text-2xl font-black leading-relaxed" translate="no">Logixa Pharmacy</h2>
              <p className="auth-legacy-copy text-sm font-bold leading-relaxed max-w-[22ch]">
                نظام متكامل لإدارة الصيدليات — مبيعات، مخزون، حسابات، وموظفين
              </p>
              <div className="auth-legacy-features mt-2 flex flex-wrap justify-center gap-4 text-xs font-bold">
                {["تقارير لحظية", "مخزون ذكي", "سحابي وآمن"].map((feat) => (
                  <span key={feat} className="flex items-center gap-1.5">
                    <span className="auth-legacy-dot size-1.5 rounded-full" />
                    {feat}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>
      {showPolicy ? <BottomPolicy /> : null}
    </div>
  )
}
