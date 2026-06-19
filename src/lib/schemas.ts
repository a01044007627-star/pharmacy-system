import { z } from "zod"

export const loginSchema = z.object({
  email: z.string().email("البريد الإلكتروني غير صحيح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
})

export const signupStep1Schema = z.object({
  projectName: z.string().min(1, "اسم الصيدلية مطلوب"),
  currency: z.string().min(1, "العملة مطلوبة"),
  country: z.string().min(1, "الدولة مطلوبة"),
  city: z.string().min(1, "المدينة مطلوبة"),
  timezone: z.string().min(1, "المنطقة الزمنية مطلوبة"),
  mobile: z.string().optional(),
})

export const signupStep2Schema = z
  .object({
    title: z.string().optional(),
    firstName: z.string().min(1, "الاسم الأول مطلوب"),
    lastName: z.string().min(1, "اسم العائلة مطلوب"),
    username: z
      .string()
      .min(1, "اسم المستخدم مطلوب")
      .regex(/^[a-zA-Z0-9_]+$/, "اسم المستخدم بالإنجليزية أو أرقام"),
    email: z.string().email("البريد الإلكتروني غير صحيح"),
    password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
    confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمة المرور غير متطابقة",
    path: ["confirmPassword"],
  })

export const signupSchema = signupStep1Schema.and(signupStep2Schema)

export const itemSchema = z.object({
  name: z.string().min(1, "اسم الصنف مطلوب"),
  barcode: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  cost_price: z.number().min(0, "سعر الشراء يجب أن يكون 0 أو أكثر"),
  selling_price: z.number().min(0, "سعر البيع يجب أن يكون 0 أو أكثر"),
  quantity: z.number().min(0, "الكمية يجب أن تكون 0 أو أكثر"),
  min_quantity: z.number().min(0).optional(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupValues = z.infer<typeof signupSchema>
export type ItemInput = z.infer<typeof itemSchema>

export function getAuthErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message
    if (msg.includes("Invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    if (msg.includes("Email not confirmed")) return "البريد الإلكتروني غير مفعل"
    if (msg.includes("rate limit")) return "طلبات كثيرة جداً، حاول بعد قليل"
    if (msg.includes("User already registered")) return "البريد الإلكتروني مسجل بالفعل"
    return msg
  }
  return "حدث خطأ غير متوقع"
}
