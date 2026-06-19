"use client"

import Link from "next/link"

export function BottomPolicy() {
  return (
    <p className="mt-4 text-center text-xs font-bold text-slate-400 leading-6">
      بالمتابعة، أنت توافق على{" "}
      <Link href="#" className="font-medium text-slate-500 underline underline-offset-4 hover:text-brand transition-colors">
        شروط الخدمة
      </Link>
      {" و "}
      <Link href="#" className="font-medium text-slate-500 underline underline-offset-4 hover:text-brand transition-colors">
        سياسة الخصوصية
      </Link>
      .
    </p>
  )
}
