import type { SelectOption } from "@/types"
import { ROUTES } from "@/config/routes"

export const authConfig = {
  redirectAfterLogin: ROUTES.dashboard,
  redirectAfterLogout: ROUTES.login,
  passwordMinLength: 6,
}

export const currencies: SelectOption[] = [
  { value: "EGP", label: "جنيه مصري (EGP)" },
  { value: "USD", label: "دولار أمريكي (USD)" },
  { value: "SAR", label: "ريال سعودي (SAR)" },
  { value: "AED", label: "درهم إماراتي (AED)" },
]

export const timezones: SelectOption[] = [
  { value: "Africa/Cairo", label: "Africa/Cairo (UTC+2)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (UTC+3)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (UTC+4)" },
  { value: "America/New_York", label: "America/New_York (UTC-5)" },
  { value: "Europe/London", label: "Europe/London (UTC+0)" },
]

export const ownerTitles: SelectOption[] = [
  { value: "د", label: "د" },
  { value: "أ.د", label: "أ.د" },
  { value: "أ", label: "أ" },
  { value: "صيدلي", label: "صيدلي" },
]

export const authContent = {
  hero: {
    title: "Logixa Pharmacy",
    subtitle: "نظام متكامل لإدارة الصيدليات — مبيعات، مخزون، حسابات، وموظفين",
    signupSubtitle: "ابدأ رحلة إدارة صيدليتك بكل احترافية",
    features: ["تقارير لحظية", "مخزون ذكي", "سحابي وآمن"],
    signupFeatures: ["بدون تعقيد", "دعم فني مجاني", "تحديثات مستمرة"],
  },
}
