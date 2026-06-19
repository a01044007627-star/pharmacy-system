import type { SoundName } from "@/hooks/use-sound"
import type { NotifType } from "@/types/notifications"

export type NotificationScenarioId =
  | "sale.completed"
  | "payment.received"
  | "sale.returned"
  | "purchase.created"
  | "purchase.returned"
  | "inventory.item_added"
  | "inventory.low_stock"
  | "inventory.critical_stock"
  | "inventory.transfer_completed"
  | "cashier.shift_started"
  | "cashier.shift_ended"
  | "task.reminder"
  | "sync.completed"
  | "sync.failed"
  | "user.created"
  | "user.permission_changed"

export interface NotificationScenario {
  id: NotificationScenarioId
  label: string
  category: "sales" | "purchases" | "inventory" | "cashier" | "users" | "system" | "tasks"
  type: NotifType
  sound: SoundName
  href?: string
  dedupeWindowMs: number
  title: string
  description: string
}

export type NotificationScenarioVars = Record<string, string | number | null | undefined>

export const notificationScenarios: NotificationScenario[] = [
  {
    id: "sale.completed",
    label: "بيع مكتمل",
    category: "sales",
    type: "success",
    sound: "cash-register",
    href: "/dashboard/sales",
    dedupeWindowMs: 2_500,
    title: "تم تسجيل عملية بيع",
    description: "الفاتورة {invoice} بقيمة {amount} ج.م تم حفظها بنجاح.",
  },
  {
    id: "payment.received",
    label: "تحصيل دفعة",
    category: "sales",
    type: "success",
    sound: "payment-received",
    href: "/dashboard/accounts/cash",
    dedupeWindowMs: 3_000,
    title: "تم استلام دفعة",
    description: "تم تحصيل {amount} ج.م من {customer}.",
  },
  {
    id: "sale.returned",
    label: "مرتجع بيع",
    category: "sales",
    type: "warning",
    sound: "void-transaction",
    href: "/dashboard/sales/returns",
    dedupeWindowMs: 4_000,
    title: "تم تسجيل مرتجع بيع",
    description: "تم حفظ مرتجع الفاتورة {invoice} بقيمة {amount} ج.م.",
  },
  {
    id: "purchase.created",
    label: "شراء جديد",
    category: "purchases",
    type: "success",
    sound: "item-added",
    href: "/dashboard/purchases",
    dedupeWindowMs: 3_000,
    title: "تم إضافة فاتورة شراء",
    description: "تم حفظ فاتورة شراء من {supplier} بقيمة {amount} ج.م.",
  },
  {
    id: "purchase.returned",
    label: "مرتجع شراء",
    category: "purchases",
    type: "warning",
    sound: "warning",
    href: "/dashboard/purchases/returns",
    dedupeWindowMs: 4_000,
    title: "تم تسجيل مرتجع شراء",
    description: "تم حفظ مرتجع شراء للمورد {supplier}.",
  },
  {
    id: "inventory.item_added",
    label: "صنف جديد",
    category: "inventory",
    type: "success",
    sound: "item-added",
    href: "/dashboard/items",
    dedupeWindowMs: 3_000,
    title: "تم إضافة صنف جديد",
    description: "تم حفظ الصنف {item} داخل المخزون.",
  },
  {
    id: "inventory.low_stock",
    label: "نقص مخزون",
    category: "inventory",
    type: "warning",
    sound: "low-stock",
    href: "/dashboard/stocktaking/stock",
    dedupeWindowMs: 30_000,
    title: "صنف تحت الحد الأدنى",
    description: "الصنف {item} وصل إلى {stock} فقط، والحد الأدنى {min}.",
  },
  {
    id: "inventory.critical_stock",
    label: "مخزون خطر",
    category: "inventory",
    type: "error",
    sound: "error",
    href: "/dashboard/stocktaking/stock",
    dedupeWindowMs: 60_000,
    title: "مخزون خطر يحتاج تدخل",
    description: "الصنف {item} شبه نفد من المخزون الحالي.",
  },
  {
    id: "inventory.transfer_completed",
    label: "تحويل مخزني",
    category: "inventory",
    type: "success",
    sound: "success",
    href: "/dashboard/stocktaking/transfer",
    dedupeWindowMs: 4_000,
    title: "تم التحويل المخزني",
    description: "تم نقل {count} صنف من {from} إلى {to}.",
  },
  {
    id: "cashier.shift_started",
    label: "فتح شيفت",
    category: "cashier",
    type: "info",
    sound: "shift-start",
    href: "/dashboard/sales/cashier",
    dedupeWindowMs: 10_000,
    title: "تم فتح شيفت الكاشير",
    description: "بدأ الشيفت بواسطة {user}.",
  },
  {
    id: "cashier.shift_ended",
    label: "إغلاق شيفت",
    category: "cashier",
    type: "success",
    sound: "shift-end",
    href: "/dashboard/sales/cashier",
    dedupeWindowMs: 10_000,
    title: "تم إغلاق شيفت الكاشير",
    description: "تم إغلاق الشيفت بإجمالي {amount} ج.م.",
  },
  {
    id: "task.reminder",
    label: "تذكير مهمة",
    category: "tasks",
    type: "info",
    sound: "reminder",
    href: "/dashboard/tasks",
    dedupeWindowMs: 20_000,
    title: "تذكير مهمة",
    description: "لديك مهمة مستحقة: {task}.",
  },
  {
    id: "sync.completed",
    label: "مزامنة ناجحة",
    category: "system",
    type: "success",
    sound: "success",
    href: "/dashboard/sync",
    dedupeWindowMs: 15_000,
    title: "تمت المزامنة بنجاح",
    description: "تم رفع ومراجعة آخر تعديلات الفرع.",
  },
  {
    id: "sync.failed",
    label: "فشل مزامنة",
    category: "system",
    type: "error",
    sound: "error",
    href: "/dashboard/sync",
    dedupeWindowMs: 15_000,
    title: "فشل في المزامنة",
    description: "تعذر مزامنة البيانات. راجع الاتصال أو سجل المزامنة.",
  },
  {
    id: "user.created",
    label: "مستخدم جديد",
    category: "users",
    type: "success",
    sound: "success",
    href: "/dashboard/users",
    dedupeWindowMs: 5_000,
    title: "تم إضافة مستخدم",
    description: "تم إضافة {user} إلى مستخدمي الصيدلية.",
  },
  {
    id: "user.permission_changed",
    label: "تعديل صلاحية",
    category: "users",
    type: "warning",
    sound: "warning",
    href: "/dashboard/users/roles",
    dedupeWindowMs: 5_000,
    title: "تم تعديل صلاحيات مستخدم",
    description: "تم تحديث صلاحيات {user} بواسطة الإدارة.",
  },
]

export const notificationScenarioMap = notificationScenarios.reduce(
  (acc, scenario) => {
    acc[scenario.id] = scenario
    return acc
  },
  {} as Record<NotificationScenarioId, NotificationScenario>,
)

export function renderNotificationTemplate(template: string, vars: NotificationScenarioVars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key]
    return value === null || value === undefined || value === "" ? "—" : String(value)
  })
}
