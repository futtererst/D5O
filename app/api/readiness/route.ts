import { NextResponse } from "next/server";
import { summarizeProductionReadiness } from "@/lib/d5o/security/production-readiness";

export async function GET() {
  const readiness = await summarizeProductionReadiness();

  return NextResponse.json(readiness, {
    status: readiness.ok ? 200 : 503,
    headers: {
      "cache-control": "no-store"
    }
  });
}
