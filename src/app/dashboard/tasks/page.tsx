"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Circle, List, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { DashboardPageHeader } from "@/components/shared/page-ui"
import { EmptyState, SkeletonRows } from "@/components/shared/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type Task = { id: string; title: string; completed: boolean; priority: string; created_at: string }

export default function TasksPage() {
  const auth = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!auth.activePharmacyId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId, page_size: "100" })
      const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({})) as { tasks?: Task[]; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل تحميل المهام")
      setTasks(data.tasks ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحميل المهام")
    } finally {
      setLoading(false)
    }
  }, [auth.activePharmacyId])

  useEffect(() => { void load() }, [load])

  async function addTask() {
    const trimmed = title.trim()
    if (!trimmed) { toast.error("أدخل نص المهمة"); return }
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, title: trimmed }),
      })
      const data = await response.json().catch(() => ({})) as { task?: Task; error?: string }
      if (!response.ok) throw new Error(data.error ?? "فشل إضافة المهمة")
      toast.success("تمت إضافة المهمة")
      setTitle("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل إضافة المهمة")
    }
  }

  async function toggleTask(id: string) {
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pharmacy_id: auth.activePharmacyId, task_id: id, completed: !tasks.find((t) => t.id === id)?.completed }),
      })
      if (!response.ok) throw new Error("فشل تحديث المهمة")
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل تحديث المهمة")
    }
  }

  async function deleteTask(id: string) {
    try {
      const params = new URLSearchParams({ pharmacy_id: auth.activePharmacyId ?? "", task_id: id })
      const response = await fetch(`/api/tasks?${params.toString()}`, { method: "DELETE" })
      if (!response.ok) throw new Error("فشل حذف المهمة")
      toast.success("تم حذف المهمة")
      setTasks((prev) => prev.filter((t) => t.id !== id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل حذف المهمة")
    }
  }

  const active = tasks.filter((t) => !t.completed).length
  const done = tasks.filter((t) => t.completed).length

  return (
    <section dir="rtl" className="page-container space-y-4 py-4 text-right sm:py-6">
      <DashboardPageHeader title="المهام" subtitle="إدارة المهام اليومية." icon={List} actions={
        <Button variant="outline" className="h-10 rounded-xl" onClick={() => void load()}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> تحديث</Button>
      } />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">قيد التنفيذ</p><p className="mt-2 text-xl font-black text-amber-600">{active.toLocaleString("ar-EG")}</p></CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-black text-slate-400">مكتملة</p><p className="mt-2 text-xl font-black text-emerald-600">{done.toLocaleString("ar-EG")}</p></CardContent></Card>
      </div>

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardContent className="flex gap-2 p-4">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addTask() }} placeholder="أضف مهمة جديدة..." className="h-11 rounded-2xl font-bold" />
          <Button className="h-11 shrink-0 rounded-2xl px-5" disabled={loading} onClick={() => void addTask()}><Plus className="size-4" /> إضافة</Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
        {loading ? <SkeletonRows count={5} /> : tasks.length === 0 ? (
          <EmptyState icon={List} title="لا توجد مهام" description="أضف مهامك اليومية للبدء." />
        ) : (
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
                <div className="flex min-w-0 items-center gap-3">
                  <button onClick={() => void toggleTask(task.id)} className="shrink-0">
                    {task.completed ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-slate-300" />}
                  </button>
                  <span className={cn("font-bold", task.completed && "text-slate-400 line-through")}>{task.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={cn("font-black", task.completed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{task.completed ? "تم" : "قيد التنفيذ"}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => void deleteTask(task.id)}><Trash2 className="size-4 text-rose-500" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}
