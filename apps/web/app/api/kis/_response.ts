import { NextResponse } from "next/server";
import { KisGuardError } from "@/lib/kis/guard";

export function kisJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init?.headers,
    },
  });
}

export function kisError(error: unknown) {
  const message =
    error instanceof KisGuardError ? error.message : "KIS proxy request failed.";

  return kisJson(
    {
      ok: false,
      error: message,
    },
    { status: error instanceof KisGuardError ? 400 : 500 },
  );
}
