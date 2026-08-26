import { NextResponse } from "next/server";
import { readIngestUploadFaultInjection } from "@/lib/ingest/upload-fault";
import {
  clientKeyFrom,
  takeUploadSlot,
  PER_CLIENT_LIMIT,
  GLOBAL_LIMIT,
} from "@/lib/ingest/rate-limit";

/**
 * 약관 업로드 → 조건카드. `services/ingest` 로 넘기는 프록시다.
 * ---------------------------------------------------------------------------
 * **여기서 추론을 하지 않는다.** 2패스와 4중 방어는 전부 파이썬 쪽에 있고, 그 코드가
 * 검증된 유일한 경로다. JS 로 다시 만들면 원문 추출기가 달라져 근거 좌표 체계가
 * 통째로 갈라진다(#76 이 pypdf 패치 하나로 그걸 보여줬다).
 *
 * 이 파일이 지는 것은 넷이다.
 *
 *   ① 키를 서버에 둔다        브라우저가 인제스트 URL 을 직접 부르지 않는다
 *   ② 쿼터                    돈이 나가는 엔드포인트다. lib/ingest/rate-limit.ts
 *   ③ 크기 상한               Vercel 본문 한도(4.5MB)에 걸리기 전에 우리가 거절한다
 *   ④ 강등                    상류가 죽어도 화면이 참고 모드로 계속 선다
 *
 * ## maxDuration
 *
 * 2패스 실측이 43.8~68.1초다(성공 기록 2건, 한투). Fluid compute 기준
 * Hobby 도 300초가 기본이자 최대이므로 여유가 있다. **60초 제한은 옛 정보다** —
 * 그 오해로 한때 "호스팅을 바꿔야 한다"고 판단했었다.
 *
 * ⚠ 프록시라 **두 번 기다린다** — 이 함수가 상류를 기다리는 동안 함수 슬롯을 잡고
 *   있다. 그래서 쿼터가 비용뿐 아니라 가용성 항목이기도 하다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel 함수의 요청 본문 한도는 4.5MB 다. 그걸 넘으면 우리 코드가 돌기 전에
 * 플랫폼이 413 을 내고, 사용자는 이유를 못 듣는다. **우리가 먼저 거절한다.**
 *
 * 파이썬 쪽 `MAX_UPLOAD_BYTES` 는 20MB 인데, 그건 프록시를 안 거치는 직접 호출
 * (벤치마크·로컬)을 상정한 값이라 그대로 둔다. 실제 약관은 0.01~1.12MB 다
 * (`data/terms` 7종 실측)이므로 이 상한에 걸릴 문서는 사실상 없다.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ALLOWED_SUFFIXES = [".pdf", ".htm", ".html"] as const;

/** 상류가 **최대 68초**(실측 2건 중 느린 쪽)를 쓰므로 넉넉히 두되, 함수 상한(300s)보다는 먼저 끊는다. */
const UPSTREAM_BUDGET_MS = 240_000;

function json(body: unknown, init: ResponseInit) {
  return NextResponse.json(body, init);
}

export async function POST(request: Request) {
  const base = process.env.INGEST_BASE_URL?.trim();
  if (!base) {
    // 배포에 인제스트가 안 붙어 있는 상태. **없는 기능을 있는 척하지 않는다.**
    return json(
      {
        ok: false,
        error: "약관 업로드가 이 배포본에 연결돼 있지 않습니다",
        detail: "INGEST_BASE_URL 미설정 — 사전 계산된 조건카드로 계속 사용할 수 있습니다",
      },
      { status: 503 },
    );
  }

  // 리허설용 강등 주입. 공개 요청이 강제할 수 없도록 env 로만 켜진다.
  const fault = readIngestUploadFaultInjection();
  if (fault) {
    return json(
      { ok: false, mode: fault.mode, fault: fault.fault, error: fault.userMessage },
      { status: 503, headers: { "Retry-After": String(fault.retryAfterSeconds) } },
    );
  }

  const quota = takeUploadSlot(clientKeyFrom(request.headers));
  if (!quota.allowed) {
    return json(
      {
        ok: false,
        error:
          quota.scope === "global"
            ? "지금은 업로드 요청이 몰려 있습니다. 잠시 뒤 다시 시도해 주세요"
            : "업로드 횟수 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요",
        limit: quota.scope === "global" ? GLOBAL_LIMIT : PER_CLIENT_LIMIT,
        scope: quota.scope,
      },
      {
        status: 429,
        headers: { "Retry-After": String(quota.retryAfterSeconds ?? 3600) },
      },
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    file = candidate instanceof File ? candidate : null;
  } catch {
    return json({ ok: false, error: "업로드 형식을 읽지 못했습니다" }, { status: 400 });
  }

  if (!file) {
    return json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  }

  const name = file.name || "upload";
  if (!ALLOWED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) {
    return json(
      {
        ok: false,
        error: "PDF 또는 HTML 약관 파일만 처리합니다",
        allowed: ALLOWED_SUFFIXES,
      },
      { status: 415 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return json(
      {
        ok: false,
        error: `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        limitBytes: MAX_UPLOAD_BYTES,
      },
      { status: 413 },
    );
  }

  const upstream = new FormData();
  upstream.append("file", file, name);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_BUDGET_MS);
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/ingest`, {
      method: "POST",
      body: upstream,
      signal: controller.signal,
    });

    const text = await response.text();
    const headers = new Headers({ "Content-Type": "application/json" });
    // 인제스트가 남기는 시간·토큰 텔레메트리를 그대로 넘긴다 — 화면이 아니라
    // 리허설이 읽는다. 여기서 접으면 어디서 느렸는지 알 수 없다.
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-ingest-")) headers.set(key, value);
    });
    return new NextResponse(text, { status: response.status, headers });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return json(
      {
        ok: false,
        error: aborted
          ? "약관 분석이 시간 안에 끝나지 않았습니다"
          : "약관 분석 서버에 닿지 못했습니다",
        detail: "사전 계산된 조건카드로 계속 사용할 수 있습니다",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
