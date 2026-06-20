export const productName = "Logixa Pharmacy"

export const appVersion = "1.0.0"

export const sidebarItems = [
  { title: "الرئيسية", icon: "home", href: "/dashboard" },
  { title: "لوحة المتابعة", icon: "layout-dashboard", href: "/dashboard/home" },
  {
    title: "المبيعات", icon: "shopping-cart", href: "/dashboard/sales",
    children: [
      { title: "الكاشير", href: "/dashboard/sales/cashier" },
      { title: "الفواتير", href: "/dashboard/sales" },
      { title: "مسودة الفواتير", href: "/dashboard/sales/drafts" },
      { title: "عروض الأسعار", href: "/dashboard/sales/price-offers" },
      { title: "مرتجعات المبيعات", href: "/dashboard/sales/returns" },
      { title: "المرتجعات المجانية", href: "/dashboard/sales/free-returns" },
      { title: "الشحن والتوصيل", href: "/dashboard/sales/shipping" },
      { title: "العروض والخصومات", href: "/dashboard/sales/promotions" },
    ],
  },
  {
    title: "المشتريات", icon: "truck", href: "/dashboard/purchases",
    children: [
      { title: "أوامر الشراء", href: "/dashboard/purchases/orders" },
      { title: "فواتير الشراء", href: "/dashboard/purchases" },
      { title: "مرتجعات المشتريات", href: "/dashboard/purchases/returns" },
      { title: "تكاليف الشحن", href: "/dashboard/purchases/shipping" },
    ],
  },
  {
    title: "الأدوية والأصناف", icon: "package", href: "/dashboard/items",
    children: [
      { title: "قائمة الأدوية والأصناف", href: "/dashboard/items" },
      { title: "إضافة دواء أو صنف", href: "/dashboard/items/new" },
      { title: "المجموعات", href: "/dashboard/items/groups" },
      { title: "العلامات التجارية", href: "/dashboard/items/brands" },
      { title: "الوحدات", href: "/dashboard/items/units" },
      { title: "الباركود", href: "/dashboard/items/barcode" },
      { title: "تحديث الأسعار", href: "/dashboard/items/price-update" },
      { title: "بدائل الأدوية", href: "/dashboard/items/alternatives" },
      { title: "مجموعات الأسعار", href: "/dashboard/items/price-groups" },
      { title: "محذوفات الأدوية والأصناف", href: "/dashboard/items/deleted" },
      { title: "الهالك والتالف", href: "/dashboard/items/damaged" },
      { title: "سجل الأدوية المراقبة", href: "/dashboard/controlled-drugs" },
    ],
  },
  {
    title: "الجرد", icon: "clipboard-list", href: "/dashboard/stocktaking",
    children: [
      { title: "جرد المخزون", href: "/dashboard/stocktaking" },
      { title: "الرصيد", href: "/dashboard/stocktaking/stock" },
      { title: "حركة المخزون", href: "/dashboard/stocktaking/movements" },
      { title: "تحويل مخزني", href: "/dashboard/stocktaking/transfer" },
    ],
  },
  {
    title: "المستخدمين", icon: "users", href: "/dashboard/users",
    children: [
      { title: "كل المستخدمين", href: "/dashboard/users" },
      { title: "الموظفين", href: "/dashboard/users/employees" },
      { title: "الأدوار والصلاحيات", href: "/dashboard/users/roles", devOnly: true },
    ],
  },
  {
    title: "المحاسبة", icon: "wallet", href: "/dashboard/accounts",
    children: [
      { title: "دفتر الأستاذ", href: "/dashboard/accounts" },
      { title: "الخزينة", href: "/dashboard/accounts/cash" },
      { title: "المصروفات", href: "/dashboard/accounts/expenses" },
      { title: "شجرة الحسابات", href: "/dashboard/accounts/chart" },
      { title: "إقفال حسابي", href: "/dashboard/accounts/closeout" },
    ],
  },
  {
    title: "التقارير", icon: "chart-bar", href: "/dashboard/reports",
    children: [
      { title: "مبيعات", href: "/dashboard/reports/sales" },
      { title: "مشتريات", href: "/dashboard/reports/purchases" },
      { title: "أرباح وخسائر", href: "/dashboard/reports/profit-loss" },
      { title: "الأصناف الأكثر مبيعاً", href: "/dashboard/reports/top-items" },
      { title: "حركة العملاء", href: "/dashboard/reports/customer-activity" },
      { title: "ملخص الضرائب", href: "/dashboard/reports/tax-summary" },
    ],
  },
  {
    title: "الموارد البشرية", icon: "user-check", href: "/dashboard/hr",
    children: [
      { title: "الموظفين", href: "/dashboard/hr" },
      { title: "الحضور والانصراف", href: "/dashboard/hr/attendance" },
      { title: "الرواتب", href: "/dashboard/hr/payroll" },
      { title: "الإجازات", href: "/dashboard/hr/leave" },
    ],
  },
  {
    title: "CRM", icon: "contact", href: "/dashboard/crm",
    children: [
      { title: "الزبائن", href: "/dashboard/crm" },
      { title: "الموردين", href: "/dashboard/crm/suppliers" },
      { title: "النشاطات", href: "/dashboard/crm/activities" },
      { title: "التواصل", href: "/dashboard/crm/communication" },
    ],
  },
  { title: "المرضى", icon: "heart-pulse", href: "/dashboard/patients" },
  { title: "المهام", icon: "check-square", href: "/dashboard/tasks" },
  { title: "الوصفات الطبية", icon: "file-text", href: "/dashboard/prescriptions" },
  { title: "التوصيل", icon: "box", href: "/dashboard/delivery" },
  { title: "نقاط المكافآت", icon: "gift", href: "/dashboard/loyalty" },
  { title: "الإشعارات", icon: "bell", href: "/dashboard/notifications" },
  {
    title: "المزامنة والتسوية", icon: "database", href: "/dashboard/sync",
    children: [
      { title: "لوحة المزامنة", href: "/dashboard/sync" },
      { title: "سجل المزامنة", href: "/dashboard/sync/log" },
    ],
  },
  { title: "السجلات المحذوفة", icon: "archive", href: "/dashboard/deleted-records" },
  { title: "سجل المراجعة", icon: "shield-check", href: "/dashboard/audit" },
  // إعدادات المنظومة لها تبويبات داخلية موحدة داخل صفحات الإعدادات نفسها.
  // تركها كرابط واحد يمنع تكرار التحديد بين السايد بار والـ route الداخلي.
  { title: "الإعدادات", icon: "settings", href: "/dashboard/settings" },
  { title: "لوحة المطور", icon: "wrench", href: "/dashboard/dev", devOnly: true },
]

export const navbarActions = [
  { label: "الدعم الفني", href: "https://wa.me/201000557701", icon: "headphones", kind: "pill" },
  { label: "الكاشير", href: "/dashboard/sales/cashier", icon: "gauge", kind: "pill" },
]
