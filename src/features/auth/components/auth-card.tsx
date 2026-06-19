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
      <Card className="overflow-hidden border-slate-200 shadow-xl shadow-slate-950/5 py-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1.18fr_0.82fr]">
          <div className="min-w-0 p-5 sm:p-7 lg:p-8">
            {children}
          </div>

          <div className="relative hidden min-h-[560px] overflow-hidden bg-gradient-to-br from-brand via-brand-hover to-[#0a4d7a] lg:flex flex-col items-center justify-center gap-4 p-8 text-center text-white">
            <div className="absolute inset-0">
              <Image
                src="/pharmacy-hero.png"
                alt="Logixa Pharmacy"
                fill
                priority
                sizes="(min-width: 1024px) 36vw"
                className="object-cover object-center opacity-40"
              />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
                <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                </svg>
              </div>
              <h2 className="text-2xl font-black leading-relaxed" translate="no">Logixa Pharmacy</h2>
              <p className="text-sm font-bold text-white/80 leading-relaxed max-w-[22ch]">
                نظام متكامل لإدارة الصيدليات — مبيعات، مخزون، حسابات، وموظفين
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs font-bold text-white/70">
                {["تقارير لحظية", "مخزون ذكي", "سحابي وآمن"].map((feat) => (
                  <span key={feat} className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-white/60" />
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
