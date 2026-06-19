export interface HomeActionItem {
  title: string
  href: string
  icon: string
  size?: "wide" | "normal"
}

export interface HomeActionGroup {
  title: string
  tone: "sales" | "purchases" | "inventory" | "admin"
  items: HomeActionItem[]
}

export const homeActionGroups: HomeActionGroup[] = [
  {
    title: "المبيعات",
    tone: "sales",
    items: [
      { title: "الكاشير", href: "/dashboard/sales/cashier", icon: "cash-register", size: "wide" },
      { title: "تقرير المبيعات", href: "/dashboard/reports/sales", icon: "file-chart" },
      { title: "مرتجع البيع", href: "/dashboard/sales/returns", icon: "rotate" },
      { title: "عروض الأسعار", href: "/dashboard/sales/price-offers", icon: "layers" },
      { title: "الزبائن", href: "/dashboard/crm", icon: "users" },
    ],
  },
  {
    title: "المشتريات",
    tone: "purchases",
    items: [
      { title: "إضافة شراء", href: "/dashboard/purchases", icon: "receipt", size: "wide" },
      { title: "مرتجع شراء", href: "/dashboard/purchases/returns", icon: "asterisk" },
      { title: "الموردين", href: "/dashboard/crm/suppliers", icon: "user-round" },
      { title: "المصاريف", href: "/dashboard/accounts/expenses", icon: "banknote", size: "wide" },
    ],
  },
  {
    title: "المخزون",
    tone: "inventory",
    items: [
      { title: "إضافة دواء أو صنف", href: "/dashboard/items/new", icon: "gem", size: "wide" },
      { title: "الأدوية والأصناف", href: "/dashboard/items", icon: "store", size: "wide" },
      { title: "ملصق باركود", href: "/dashboard/items/barcode", icon: "barcode" },
      { title: "نقل مخزني", href: "/dashboard/stocktaking/transfer", icon: "truck" },
    ],
  },
  {
    title: "الشؤون الإدارية والمالية",
    tone: "admin",
    items: [
      { title: "الإعدادات", href: "/dashboard/settings", icon: "settings", size: "wide" },
      { title: "المستخدمين", href: "/dashboard/users", icon: "users" },
      { title: "سجل النشاط", href: "/dashboard/notifications/audit", icon: "list" },
      { title: "الصلاحيات", href: "/dashboard/users/roles", icon: "shield" },
      { title: "الربح / الخسارة", href: "/dashboard/reports/profit-loss", icon: "hand-coins" },
    ],
  },
]
