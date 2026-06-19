import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ ok: true, service: "pharmacy-system", at: new Date().toISOString() })
}

export async function HEAD() {
  return new Response(null, { status: 204 })
}
