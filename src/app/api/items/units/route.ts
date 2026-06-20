import { NextResponse } from "next/server"
import { UnitService } from "@/features/inventory/services/unit-service"
import { UnitRepository } from "@/features/inventory/server/unit-repository"
import { operationalErrorResponse, TenantRequestContext } from "@/lib/server/tenant-request-context"

function serviceFor(context: TenantRequestContext) {
  return new UnitService(new UnitRepository(context.db, context.pharmacyId))
}

export async function GET(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "inventory:read",
      forbiddenMessage: "ليست لديك صلاحية عرض الوحدات",
    })
    const service = serviceFor(context)
    const [units, catalog] = await Promise.all([
      service.list(),
      Promise.resolve(service.catalog()),
    ])
    return NextResponse.json({ units, catalog })
  } catch (error) {
    return operationalErrorResponse(error, "units GET failed", "فشل تحميل الوحدات")
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "inventory:create",
      forbiddenMessage: "ليست لديك صلاحية إنشاء الوحدات",
    })
    const unit = await serviceFor(context).create(body)
    return NextResponse.json({ unit }, { status: 201 })
  } catch (error) {
    return operationalErrorResponse(error, "units POST failed", "فشل إنشاء الوحدة", 400)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const context = await TenantRequestContext.forMutation(request, body, {
      permission: "inventory:update",
      forbiddenMessage: "ليست لديك صلاحية تعديل الوحدات",
    })
    const unit = await serviceFor(context).update(String(body.id ?? ""), body)
    return NextResponse.json({ unit })
  } catch (error) {
    return operationalErrorResponse(error, "units PATCH failed", "فشل تعديل الوحدة", 400)
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await TenantRequestContext.from(request, {
      permission: "inventory:delete",
      forbiddenMessage: "ليست لديك صلاحية حذف الوحدات",
    })
    await serviceFor(context).delete(context.text("id"))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return operationalErrorResponse(error, "units DELETE failed", "فشل حذف الوحدة", 400)
  }
}
