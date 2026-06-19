import type { MedicalRole } from "@/types"
import type { Permission } from "@/lib/auth/permissions"

export const roleLabels: Record<MedicalRole, string> = {
  developer: "المطور",
  owner: "صاحب الصيدلية",
  admin: "مدير النظام",
  manager: "مدير تشغيل",
  accountant: "محاسب",
  pharmacist: "صيدلي",
  cashier: "كاشير",
  technician: "فني",
  worker: "عامل",
  viewer: "مشاهدة فقط",
  "no-access": "بدون وصول",
}

export const permissionGroups: Array<{ id: string; label: string; permissions: Permission[] }> = [
  {
    id: "settings",
    label: "الإعدادات",
    permissions: [
      "settings:read", "settings:write", "settings:system.read", "settings:system.write", "settings:project.read", "settings:project.write", "settings:branches.read", "settings:branches.write", "settings:tax.read", "settings:tax.write", "settings:invoice.read", "settings:invoice.write", "settings:notification-templates.read", "settings:notification-templates.write",
    ],
  },
  {
    id: "inventory",
    label: "الأصناف والمخزون",
    permissions: [
      "inventory:read", "inventory:create", "inventory:update", "inventory:delete", "inventory:restore", "inventory:archive", "inventory:stocktake", "inventory:opening-stock.write", "inventory:transfer.write", "inventory:damaged.write", "inventory:barcode.print",
      "items:view-cost", "items:view-profit", "items:export", "items:print", "items:ledger.read", "items:price-groups.write",
    ],
  },
  {
    id: "sales",
    label: "المبيعات والكاشير",
    permissions: ["sales:read", "sales:write", "sales:void", "sales:discount", "sales:price-override"],
  },
  {
    id: "purchases",
    label: "المشتريات",
    permissions: ["purchases:read", "purchases:write", "purchases:void"],
  },
  {
    id: "users",
    label: "المستخدمون والصلاحيات",
    permissions: ["users:read", "users:write", "users:delete", "roles:manage", "auth:audit.read", "auth:sessions.manage"],
  },
  {
    id: "reports",
    label: "الحسابات والتقارير",
    permissions: ["financials:read", "financials:write", "reports:read", "reports:export"],
  },
  {
    id: "notifications",
    label: "الإشعارات والنظام",
    permissions: ["notifications:read", "notifications:manage", "notifications:templates.write", "sync:read", "deleted-records:read", "deleted-records:restore"],
  },
]

export const permissionLabels: Partial<Record<Permission, string>> = {
  "system:all": "كل صلاحيات النظام",
  "settings:read": "قراءة الإعدادات",
  "settings:write": "تعديل الإعدادات العامة",
  "settings:system.read": "قراءة إعدادات النظام",
  "settings:system.write": "تعديل إعدادات النظام",
  "settings:project.read": "قراءة بيانات الصيدلية",
  "settings:project.write": "تعديل بيانات الصيدلية",
  "settings:branches.read": "قراءة الفروع",
  "settings:branches.write": "تعديل الفروع",
  "settings:tax.read": "قراءة الضرائب",
  "settings:tax.write": "تعديل الضرائب",
  "settings:invoice.read": "قراءة شكل الفاتورة",
  "settings:invoice.write": "تعديل شكل الفاتورة",
  "settings:notification-templates.read": "قراءة قوالب الإشعارات",
  "settings:notification-templates.write": "تعديل قوالب الإشعارات",
  "inventory:read": "قراءة الأصناف",
  "inventory:create": "إضافة صنف",
  "inventory:update": "تعديل صنف",
  "inventory:delete": "حذف صنف",
  "inventory:restore": "استرجاع صنف",
  "inventory:stocktake": "الجرد",
  "inventory:opening-stock.write": "كمية افتتاحية",
  "items:view-cost": "عرض سعر الشراء",
  "items:view-profit": "عرض الربح",
  "items:export": "تصدير الأصناف",
  "items:print": "طباعة الأصناف",
  "items:ledger.read": "دفتر الأستاذ للأصناف",
  "items:price-groups.write": "إدارة مجموعات الأسعار",
  "inventory:transfer.write": "تحويل مخزني",
  "inventory:damaged.write": "تسجيل هالك وتالف",
  "inventory:barcode.print": "طباعة الباركود",
  "inventory:archive": "أرشفة الأصناف",
  "sales:read": "قراءة المبيعات",
  "sales:write": "تنفيذ بيع",
  "sales:void": "إلغاء فاتورة",
  "sales:discount": "خصم على الفاتورة",
  "sales:price-override": "تغيير سعر البيع",
  "purchases:read": "قراءة المشتريات",
  "purchases:write": "تسجيل مشتريات",
  "purchases:void": "إلغاء مشتريات",
  "users:read": "قراءة المستخدمين",
  "users:write": "إضافة/تعديل مستخدم",
  "users:delete": "إيقاف مستخدم",
  "roles:manage": "إدارة الأدوار",
  "financials:read": "قراءة الحسابات",
  "financials:write": "تعديل الحسابات",
  "reports:read": "قراءة التقارير",
  "reports:export": "تصدير التقارير",
  "notifications:read": "قراءة الإشعارات",
  "notifications:manage": "إدارة الإشعارات",
  "notifications:templates.write": "تعديل قوالب الإشعارات",
  "sync:read": "متابعة المزامنة",
  "deleted-records:read": "قراءة المحذوفات",
  "deleted-records:restore": "استرجاع المحذوفات",
}

export function permissionLabel(permission: Permission): string {
  return permissionLabels[permission] ?? permission
}
