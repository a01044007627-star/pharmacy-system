"use client"

import { network } from "@/lib/network"
import { localDB } from "@/lib/sync/local-db"
import { queueApiRequest } from "@/lib/sync/api-mutations"

export type PatientRecord = Record<string, unknown> & {
  id: string
  pharmacy_id: string
  code?: string
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  gender?: "male" | "female" | null
  date_of_birth?: string | null
  birth_date?: string | null
  status?: "active" | "inactive" | "archived"
  visit_count?: number
  total_purchases?: number
  last_visit_date?: string | null
  last_visit?: string | null
  created_at?: string
  updated_at?: string
  _offline_pending?: boolean
}

export type PatientListPayload = {
  patients: PatientRecord[]
  summary: { count: number; active: number; inactive: number; archived: number }
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  offline?: boolean
}

type ListInput = {
  pharmacyId: string
  query?: string
  status?: string
  gender?: string
  page?: number
  pageSize?: number
}

function normalize(row: PatientRecord): PatientRecord {
  return {
    ...row,
    birth_date: row.birth_date ?? row.date_of_birth ?? null,
    date_of_birth: row.date_of_birth ?? row.birth_date ?? null,
    last_visit: row.last_visit ?? row.last_visit_date ?? null,
    last_visit_date: row.last_visit_date ?? row.last_visit ?? null,
    visit_count: Number(row.visit_count ?? 0),
    total_purchases: Number(row.total_purchases ?? 0),
  }
}

function matchesSearch(row: PatientRecord, query: string) {
  if (!query) return true
  const needle = query.trim().toLocaleLowerCase("ar")
  return [row.name, row.phone, row.email, row.code, row.id_number]
    .some((value) => String(value ?? "").toLocaleLowerCase("ar").includes(needle))
}

async function localList(input: ListInput): Promise<PatientListPayload> {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(10, Math.min(100, input.pageSize ?? 25))
  const all = (await localDB.getTableRows("pharmacy_patients"))
    .filter((row) => row.pharmacy_id === input.pharmacyId)
    .map((row) => normalize(row as PatientRecord))
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))
  const filtered = all.filter((row) => matchesSearch(row, input.query ?? ""))
    .filter((row) => !input.status || input.status === "all" || row.status === input.status)
    .filter((row) => !input.gender || input.gender === "all" || row.gender === input.gender)
  const start = (page - 1) * pageSize
  return {
    patients: filtered.slice(start, start + pageSize),
    summary: {
      count: all.length,
      active: all.filter((row) => row.status === "active").length,
      inactive: all.filter((row) => row.status === "inactive").length,
      archived: all.filter((row) => row.status === "archived").length,
    },
    pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    offline: true,
  }
}

export const patientsService = {
  async list(input: ListInput): Promise<PatientListPayload> {
    const params = new URLSearchParams({
      pharmacy_id: input.pharmacyId,
      query: input.query ?? "",
      status: input.status && input.status !== "all" ? input.status : "",
      gender: input.gender && input.gender !== "all" ? input.gender : "",
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 25),
    })
    if (await network.check()) {
      try {
        const response = await fetch(`/api/patients?${params.toString()}`, { cache: "no-store", credentials: "same-origin" })
        const payload = await response.json().catch(() => ({})) as PatientListPayload & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تحميل المرضى")
        const rows = (payload.patients ?? []).map(normalize)
        for (const row of rows) await localDB.putTableRow("pharmacy_patients", row, true)
        return { ...payload, patients: rows, offline: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        return localList(input)
      }
    }
    return localList(input)
  },

  async get(pharmacyId: string, patientId: string) {
    if (await network.check()) {
      try {
        const response = await fetch(`/api/patients/${patientId}?pharmacy_id=${encodeURIComponent(pharmacyId)}`, { cache: "no-store", credentials: "same-origin" })
        const payload = await response.json().catch(() => ({})) as { patient?: PatientRecord; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تحميل بيانات المريض")
        if (payload.patient) await localDB.putTableRow("pharmacy_patients", normalize(payload.patient), true)
        return payload
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const row = await localDB.getTableRow("pharmacy_patients", patientId)
    if (!row || row.pharmacy_id !== pharmacyId) throw new Error("بيانات المريض غير متاحة على هذا الجهاز دون إنترنت")
    const patient = normalize(row as PatientRecord)
    const localVisits = (await localDB.getTableRows("pharmacy_patient_visits"))
      .filter((visit) => visit.pharmacy_id === pharmacyId && visit.patient_id === patientId)
      .sort((a, b) => String(b.visit_date ?? b.created_at ?? "").localeCompare(String(a.visit_date ?? a.created_at ?? "")))
      .map((visit) => ({
        id: String(visit.id ?? crypto.randomUUID()),
        type: String(visit.visit_type ?? "manual"),
        reference: String(visit.reference_id ?? visit.reference_table ?? "زيارة"),
        date: String(visit.visit_date ?? visit.created_at ?? new Date().toISOString()),
        total: Number(visit.total_amount ?? 0),
        items_count: 0,
        doctor: null,
        diagnosis: null,
        notes: visit.notes ? String(visit.notes) : null,
      }))
    return {
      patient: {
        ...patient,
        medical: {
          allergies: Array.isArray(patient.allergies) ? patient.allergies : [],
          chronic_diseases: Array.isArray(patient.chronic_diseases) ? patient.chronic_diseases : [],
          medications: Array.isArray(patient.current_medications) ? patient.current_medications : [],
          blood_type: patient.blood_type ?? null,
          medical_history: patient.medical_history ?? null,
          surgical_history: patient.surgical_history ?? null,
          family_history: patient.family_history ?? null,
          notes: patient.medical_history ?? patient.notes ?? null,
        },
        insurance: {
          provider: patient.insurance_company ?? null,
          policy_number: patient.insurance_policy_number ?? null,
          expiry_date: patient.insurance_expiry_date ?? null,
          coverage_percent: 0,
        },
        emergency: { name: patient.emergency_contact_name ?? null, phone: patient.emergency_contact_phone ?? null },
        visits: localVisits,
      },
      offline: true,
    }
  },

  async create(pharmacyId: string, input: Record<string, unknown>) {
    const id = String(input.client_request_id ?? crypto.randomUUID())
    const body = { ...input, pharmacy_id: pharmacyId, client_request_id: id }
    if (await network.check()) {
      try {
        const response = await fetch("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as { patient?: PatientRecord; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل إنشاء المريض")
        if (payload.patient) await localDB.putTableRow("pharmacy_patients", normalize(payload.patient), true)
        return { ...payload, queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const now = new Date().toISOString()
    const local: PatientRecord = normalize({
      id,
      client_request_id: id,
      pharmacy_id: pharmacyId,
      code: "في انتظار المزامنة",
      name: String(input.name ?? "").trim(),
      phone: String(input.phone ?? "").trim() || null,
      email: String(input.email ?? "").trim() || null,
      address: String(input.address ?? "").trim() || null,
      gender: input.gender === "female" ? "female" : "male",
      date_of_birth: String(input.date_of_birth ?? input.birth_date ?? "") || null,
      birth_date: String(input.date_of_birth ?? input.birth_date ?? "") || null,
      status: "active",
      visit_count: 0,
      total_purchases: 0,
      created_at: now,
      updated_at: now,
      _offline_pending: true,
      ...input,
    })
    await localDB.putTableRow("pharmacy_patients", local, false)
    await queueApiRequest({ path: "/api/patients", method: "POST", body, label: `إضافة المريض ${local.name}` })
    return { patient: local, queued: true }
  },

  async update(pharmacyId: string, patientId: string, input: Record<string, unknown>) {
    const body = { ...input, pharmacy_id: pharmacyId }
    if (await network.check()) {
      try {
        const response = await fetch(`/api/patients/${patientId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({})) as { patient?: PatientRecord; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل تعديل المريض")
        if (payload.patient) await localDB.putTableRow("pharmacy_patients", normalize(payload.patient), true)
        return { ...payload, queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const existing = await localDB.getTableRow("pharmacy_patients", patientId)
    if (!existing) throw new Error("ملف المريض غير موجود محليًا")
    const updated = normalize({ ...existing, ...input, id: patientId, pharmacy_id: pharmacyId, updated_at: new Date().toISOString(), _offline_pending: true } as PatientRecord)
    await localDB.putTableRow("pharmacy_patients", updated, false)
    await queueApiRequest({ path: `/api/patients/${patientId}`, method: "PATCH", body, label: `تعديل المريض ${updated.name}` })
    return { patient: updated, queued: true }
  },

  async archive(pharmacyId: string, patientId: string) {
    if (await network.check()) {
      try {
        const response = await fetch(`/api/patients/${patientId}?pharmacy_id=${encodeURIComponent(pharmacyId)}`, { method: "DELETE", credentials: "same-origin" })
        const payload = await response.json().catch(() => ({})) as { error?: string }
        if (!response.ok) throw new Error(payload.error ?? "فشل أرشفة المريض")
        const existing = await localDB.getTableRow("pharmacy_patients", patientId)
        if (existing) await localDB.putTableRow("pharmacy_patients", { ...existing, status: "archived", updated_at: new Date().toISOString() }, true)
        return { queued: false }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
    }
    const existing = await localDB.getTableRow("pharmacy_patients", patientId)
    if (!existing) throw new Error("ملف المريض غير موجود محليًا")
    await localDB.putTableRow("pharmacy_patients", { ...existing, status: "archived", updated_at: new Date().toISOString(), _offline_pending: true }, false)
    await queueApiRequest({ path: `/api/patients/${patientId}?pharmacy_id=${encodeURIComponent(pharmacyId)}`, method: "DELETE", label: `أرشفة المريض ${String(existing.name ?? "")}` })
    return { queued: true }
  },
}
