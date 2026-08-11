import { NextResponse } from "next/server";
import { checkAnthropicModelsHealth } from "@/lib/ingest/anthropic-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkAnthropicModelsHealth();

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
