"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

export type PatientFormData = {
  name: string
  phone: string
  email: string
  gender: "male" | "female"
  birth_date: string
  address: string
  id_number: string
  blood_type: string
  allergies: string
  chronic_diseases: string
  current_medications: string
  medical_history: string
  surgical_history: string
  family_history: string
  emergency_contact_name: string
  emergency_contact_phone: string
  insurance_company: string
  insurance_policy_number: string
  insurance_expiry_date: string
  notes: string
}

export const emptyPatientForm: PatientFormData = {
  name: "", phone: "", email: "", gender: "male", birth_date: "", address: "", id_number: "", blood_type: "",
  allergies: "", chronic_diseases: "", current_medications: "", medical_history: "", surgical_history: "", family_history: "",
  emergency_contact_name: "", emergency_contact_phone: "", insurance_company: "", insurance_policy_number: "", insurance_expiry_date: "", notes: "",
}

function join(value: unknown) {
  return Array.isArray(value) ? value.join("، ") : String(value ?? "")
}

export function patientToForm(patient: Record<string, unknown>): PatientFormData {
  return {
    name: String(patient.name ?? ""), phone: String(patient.phone ?? ""), email: String(patient.email ?? ""),
    gender: patient.gender === "female" ? "female" : "male",
    birth_date: String(patient.birth_date ?? patient.date_of_birth ?? "").slice(0, 10), address: String(patient.address ?? ""),
    id_number: String(patient.id_number ?? ""), blood_type: String(patient.blood_type ?? ""),
    allergies: join(patient.allergies ?? (patient.medical as Record<string, unknown> | undefined)?.allergies),
    chronic_diseases: join(patient.chronic_diseases ?? (patient.medical as Record<string, unknown> | undefined)?.chronic_diseases),
    current_medications: join(patient.current_medications ?? (patient.medical as Record<string, unknown> | undefined)?.medications),
    medical_history: String(patient.medical_history ?? (patient.medical as Record<string, unknown> | undefined)?.medical_history ?? ""),
    surgical_history: String(patient.surgical_history ?? (patient.medical as Record<string, unknown> | undefined)?.surgical_history ?? ""),
    family_history: String(patient.family_history ?? (patient.medical as Record<string, unknown> | undefined)?.family_history ?? ""),
    emergency_contact_name: String(patient.emergency_contact_name ?? (patient.emergency as Record<string, unknown> | undefined)?.name ?? ""),
    emergency_contact_phone: String(patient.emergency_contact_phone ?? (patient.emergency as Record<string, unknown> | undefined)?.phone ?? ""),
    insurance_company: String(patient.insurance_company ?? (patient.insurance as Record<string, unknown> | undefined)?.provider ?? ""),
    insurance_policy_number: String(patient.insurance_policy_number ?? (patient.insurance as Record<string, unknown> | undefined)?.policy_number ?? ""),
    insurance_expiry_date: String(patient.insurance_expiry_date ?? (patient.insurance as Record<string, unknown> | undefined)?.expiry_date ?? "").slice(0, 10),
    notes: String(patient.notes ?? ""),
  }
}

function split(value: string) {
  return value.split(/[,،\n]/).map((part) => part.trim()).filter(Boolean)
}

export function patientFormPayload(form: PatientFormData) {
  return {
    ...form,
    date_of_birth: form.birth_date || null,
    birth_date: form.birth_date || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    id_number: form.id_number.trim() || null,
    blood_type: form.blood_type || null,
    allergies: split(form.allergies),
    chronic_diseases: split(form.chronic_diseases),
    current_medications: split(form.current_medications),
    medical_history: form.medical_history.trim() || null,
    surgical_history: form.surgical_history.trim() || null,
    family_history: form.family_history.trim() || null,
    emergency_contact_name: form.emergency_contact_name.trim() || null,
    emergency_contact_phone: form.emergency_contact_phone.trim() || null,
    insurance_company: form.insurance_company.trim() || null,
    insurance_policy_number: form.insurance_policy_number.trim() || null,
    insurance_expiry_date: form.insurance_expiry_date || null,
    notes: form.notes.trim() || null,
  }
}

export function PatientFormFields({ value, onChange }: { value: PatientFormData; onChange: (value: PatientFormData) => void }) {
  const set = <K extends keyof PatientFormData>(key: K, next: PatientFormData[K]) => onChange({ ...value, [key]: next })
  const inputClass = "h-11 rounded-xl border-white/10 bg-slate-800 font-bold text-white placeholder:text-slate-500"
  const areaClass = "min-h-24 rounded-xl border-white/10 bg-slate-800 font-bold text-white placeholder:text-slate-500"
  return (
    <div className="space-y-5">
      <FormSection title="البيانات الأساسية">
        <Field label="اسم المريض *" wide><Input value={value.name} onChange={(e) => set("name", e.target.value)} className={inputClass} /></Field>
        <Field label="رقم الهاتف"><Input value={value.phone} onChange={(e) => set("phone", e.target.value)} className={inputClass} dir="ltr" /></Field>
        <Field label="البريد الإلكتروني"><Input type="email" value={value.email} onChange={(e) => set("email", e.target.value)} className={inputClass} dir="ltr" /></Field>
        <Field label="الجنس"><NativeSelect value={value.gender} onChange={(e) => set("gender", e.target.value as "male" | "female")} className={inputClass}><NativeSelectOption value="male">ذكر</NativeSelectOption><NativeSelectOption value="female">أنثى</NativeSelectOption></NativeSelect></Field>
        <Field label="تاريخ الميلاد"><Input type="date" max={new Date().toISOString().slice(0, 10)} value={value.birth_date} onChange={(e) => set("birth_date", e.target.value)} className={inputClass} /></Field>
        <Field label="الرقم القومي/رقم الهوية"><Input value={value.id_number} onChange={(e) => set("id_number", e.target.value)} className={inputClass} /></Field>
        <Field label="العنوان" wide><Input value={value.address} onChange={(e) => set("address", e.target.value)} className={inputClass} /></Field>
      </FormSection>

      <FormSection title="السجل الطبي والأدوية">
        <Field label="فصيلة الدم"><NativeSelect value={value.blood_type} onChange={(e) => set("blood_type", e.target.value)} className={inputClass}><NativeSelectOption value="">غير محددة</NativeSelectOption>{["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></Field>
        <Field label="الحساسية"><Input value={value.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="افصل بفاصلة" className={inputClass} /></Field>
        <Field label="الأمراض المزمنة"><Input value={value.chronic_diseases} onChange={(e) => set("chronic_diseases", e.target.value)} placeholder="سكر، ضغط..." className={inputClass} /></Field>
        <Field label="الأدوية الحالية"><Input value={value.current_medications} onChange={(e) => set("current_medications", e.target.value)} placeholder="افصل بفاصلة" className={inputClass} /></Field>
        <Field label="التاريخ المرضي" wide><Textarea value={value.medical_history} onChange={(e) => set("medical_history", e.target.value)} className={areaClass} /></Field>
        <Field label="العمليات الجراحية"><Textarea value={value.surgical_history} onChange={(e) => set("surgical_history", e.target.value)} className={areaClass} /></Field>
        <Field label="التاريخ المرضي للعائلة"><Textarea value={value.family_history} onChange={(e) => set("family_history", e.target.value)} className={areaClass} /></Field>
      </FormSection>

      <FormSection title="الطوارئ والتأمين">
        <Field label="اسم شخص للطوارئ"><Input value={value.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} className={inputClass} /></Field>
        <Field label="هاتف الطوارئ"><Input value={value.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} className={inputClass} dir="ltr" /></Field>
        <Field label="شركة التأمين"><Input value={value.insurance_company} onChange={(e) => set("insurance_company", e.target.value)} className={inputClass} /></Field>
        <Field label="رقم بوليصة التأمين"><Input value={value.insurance_policy_number} onChange={(e) => set("insurance_policy_number", e.target.value)} className={inputClass} /></Field>
        <Field label="انتهاء التأمين"><Input type="date" value={value.insurance_expiry_date} onChange={(e) => set("insurance_expiry_date", e.target.value)} className={inputClass} /></Field>
        <Field label="ملاحظات" wide><Textarea value={value.notes} onChange={(e) => set("notes", e.target.value)} className={areaClass} /></Field>
      </FormSection>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"><h3 className="mb-4 text-sm font-black text-cyan-400">{title}</h3><div className="grid gap-4 sm:grid-cols-2">{children}</div></section>
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}><Label className="text-xs font-black text-slate-300">{label}</Label>{children}</div>
}
