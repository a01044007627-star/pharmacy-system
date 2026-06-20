"use client"

import { useState, useEffect, useCallback } from "react"
import { FileText, Mail, MessageSquare, Bell } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SettingsEntityService } from "@/features/settings/services/settings-entity-service"
import { notificationScenarios } from "@/config/notification-scenarios"
import { useAuth } from "@/contexts/auth-context"
import { useSettingsPermissions } from "@/features/settings/hooks/use-settings-permissions"
import { SettingsLayout } from "@/features/settings/components/settings-layout"
import { ToggleField } from "@/features/settings/components/settings-form"
import { Loader2 } from "lucide-react"

interface NotificationTemplate {
  id: string
  pharmacy_id: string
  scenario: string
  name?: string
  channel: "email" | "sms" | "in_app"
  subject: string
  body: string
  tags: string
  auto_send: boolean
  is_default?: boolean
  status?: string
}

const categoryLabels: Record<string, string> = {
  sales: "المبيعات",
  purchases: "المشتريات",
  inventory: "المخزون",
  cashier: "الكاشير",
  users: "المستخدمين",
  system: "النظام",
  tasks: "المهام",
  loyalty: "المكافآت",
}

const templateGroups = Array.from(new Set(notificationScenarios.map((scenario) => scenario.category))).map((category) => ({
  id: category,
  label: categoryLabels[category] ?? category,
  icon: FileText,
}))

const channels: NotificationTemplate["channel"][] = ["in_app", "email", "sms"]

function extractTags(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(/\{(\w+)\}/g)).map((match) => `{${match[1]}}`))).join(", ")
}

function buildDefaultTemplates(pharmacyId: string): Partial<NotificationTemplate>[] {
  return notificationScenarios.flatMap((scenario) => channels.map((channel) => ({
    pharmacy_id: pharmacyId,
    scenario: scenario.id,
    name: scenario.label,
    channel,
    subject: scenario.title,
    body: scenario.description,
    tags: extractTags(`${scenario.title} ${scenario.description}`),
    auto_send: channel === "in_app",
    is_default: true,
    status: "active",
  })))
}


const channelIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  in_app: Bell,
}

const channelLabels: Record<string, string> = {
  email: "البريد الإلكتروني",
  sms: "الرسائل النصية",
  in_app: "داخل التطبيق",
}

function TemplatesContent() {
  const { can } = useAuth()
  const { canRead, canWrite } = useSettingsPermissions("notificationTemplates")
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState("sales")

  const canWriteTemplates = can("settings:write") && canWrite

  const loadTemplates = useCallback(async () => {
    if (!canRead) { setLoading(false); return }
    try {
      let data = await SettingsEntityService.list<NotificationTemplate>("notification-templates")
      if (data.length === 0 && canWriteTemplates) {
        await Promise.all(buildDefaultTemplates("").map((template) => SettingsEntityService.create<NotificationTemplate>("notification-templates", template as unknown as Record<string, unknown>)))
        data = await SettingsEntityService.list<NotificationTemplate>("notification-templates")
      }
      setTemplates(data)
    } catch {
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [canRead, canWriteTemplates])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  const groupedTemplates = templates.filter((t) => t.scenario.startsWith(activeGroup))

  async function handleSave(template: NotificationTemplate, field: string, value: string | boolean) {
    if (!canWriteTemplates) { toast.error("ليست لديك صلاحية تعديل القوالب"); return }
    try {
      await SettingsEntityService.update<NotificationTemplate>("notification-templates", template.id, { [field]: value })
      setTemplates((prev) => prev.map((t) => t.id === template.id ? { ...t, [field]: value } : t))
      toast.success("تم حفظ القالب")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ القالب")
    } finally {
      // Keep the async boundary explicit so save failures are surfaced consistently.
    }
  }

  if (!canRead) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <p className="text-sm font-bold text-slate-500">ليس لديك صلاحية الوصول</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="text-right">
        <h1 className="text-lg font-black text-slate-900">قوالب الإشعارات</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">تعديل محتوى قوالب الإشعارات</p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2">
        {templateGroups.map((group) => {
          const Icon = group.icon
          return (
            <button
              key={group.id}
              onClick={() => setActiveGroup(group.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition ${activeGroup === group.id ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Icon className="size-4" />
              {group.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-4">
        {groupedTemplates.length === 0 ? (
          <Card className="rounded-xl border-slate-200 bg-white py-8 text-center shadow-sm">
            <FileText className="mx-auto mb-2 size-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">لا توجد قوالب في هذه المجموعة</p>
          </Card>
        ) : groupedTemplates.map((template) => {
          const ChannelIcon = channelIcons[template.channel] ?? FileText
          return (
            <Card key={template.id} className="rounded-xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                    <ChannelIcon className="size-4" />
                  </span>
                  <CardTitle className="text-sm font-black text-slate-900">
                    {template.name || template.scenario}
                    <span className="mr-2 text-[10px] font-bold text-slate-400">({channelLabels[template.channel] ?? template.channel})</span>
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <ToggleField
                    label="إرسال تلقائي"
                    checked={template.auto_send}
                    onChange={(v) => handleSave(template, "auto_send", v)}
                    disabled={!canWriteTemplates}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">الموضوع</span>
                  <Input
                    value={template.subject}
                    onChange={(e) => handleSave(template, "subject", e.target.value)}
                    disabled={!canWriteTemplates}
                    className="h-9 rounded-lg"
                  />
                </div>
                <div className="grid gap-1.5 text-right">
                  <span className="text-xs font-black text-slate-700">المحتوى</span>
                  <Textarea
                    value={template.body}
                    onChange={(e) => handleSave(template, "body", e.target.value)}
                    disabled={!canWriteTemplates}
                    rows={4}
                    className="min-h-24 rounded-xl text-right"
                  />
                </div>
                {template.tags ? (
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-400">الوسوم المتاحة: </span>
                    <span className="text-xs font-semibold text-brand">{template.tags}</span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function NotificationTemplatesPage() {
  return (
    <SettingsLayout>
      <TemplatesContent />
    </SettingsLayout>
  )
}
