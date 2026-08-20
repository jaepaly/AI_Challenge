/**
 * KIS 프록시 타임아웃 예산 회귀 — **이 파일이 없던 이유가 곧 문제였다.**
 * ---------------------------------------------------------------------------
 * `client.ts`는 `import "server-only"` 때문에 vitest가 로드하지 못했고
 * ("Failed to load url server-only"), 그래서 이 프록시의 핵심 안전 속성인
 * 타임아웃 예산이 테스트 0건이었다. `vitest.config.ts`의 별칭으로 뚫었다(#39 리뷰).
 *
 * 여기서 재는 것은 **벽시계 상한**이다. 8초 예산을 넘겨 도는 경로가 있으면
 * 라우트의 `maxDuration = 10`을 넘겨 우리 `{ok:false}` 대신 플랫폼 오류가 나간다 —
 * 저하 모드가 정확히 필요한 순간에만 사라진다.
 *
 * ⚠ `fetch` 스텁은 첫 줄에서 `signal.aborted`를 봐야 한다. 실제 `fetch`는 호출
 * 시점에 이미 abort된 signal이면 즉시 거부하는데, 이벤트만 듣는 스텁은 그걸
 * 놓쳐 **없는 초과를 만들어낸다**(실제로 12초로 잘못 쟀다).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const TOKEN_OK = () =>
  new Response(
    JSON.stringify({
      access_token: "t",
      token_type: "Bearer",
      expires_in: 86_400,
      access_token_token_expired: "2099-01-01 00:00:00",
    }),
    { status: 200 },
  );

/** KIS는 레이트리밋을 HTTP 200 + msg_cd로 준다 — 상태코드로는 안 보인다 */
const RATE_LIMITED = () =>
  new Response(JSON.stringify({ rt_cd: "1", msg_cd: "EGW00201" }), { status: 200 });

function sleep(ms: number, signal?: AbortSignal | null) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    });
  });
}

/** 업무 호출마다 `delayMs` 뒤에 레이트리밋을 주는 상류를 흉내낸다 */
async function runRateLimited(delayMs: number) {
  process.env.KIS_APP_KEY = "k";
  process.env.KIS_APP_SECRET = "s";
  process.env.KIS_ENV = "vps";

  let attempts = 0;
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("tokenP")) return TOKEN_OK();
    attempts += 1;
    await sleep(delayMs, init?.signal);
    return RATE_LIMITED();
  });

  const { kisGet } = await import("./client");
  const startedAt = Date.now();
  let error: { status?: number; message?: string } | undefined;
  try {
    await kisGet({ purpose: "quote", path: "/uapi/x", params: { A: "1" } });
  } catch (caught) {
    error = caught as { status?: number; message?: string };
  }
  return { elapsedMs: Date.now() - startedAt, attempts, error };
}

describe("KIS 프록시 — 요청 예산", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("백오프가 예산을 넘겨 자지 않는다 — 8초 예산, 10초 maxDuration", async () => {
    // 2,700ms는 수정 전 최악 지점이었다: 2회차 백오프(2초)가 만료 직후까지
    // 이어져 총 9,441ms가 나왔다. 여유가 559ms였다.
    const { elapsedMs, error } = await runRateLimited(2_700);

    expect(error?.status).toBe(504);
    expect(elapsedMs).toBeLessThan(9_000);
  }, 30_000);

  it("상류가 계속 조르면 예산에서 끊는다 — 시도 수와 무관하게", async () => {
    const { elapsedMs, error } = await runRateLimited(4_500);

    expect(error?.status).toBe(504);
    expect(elapsedMs).toBeLessThan(9_000);
  }, 30_000);

  it("레이트리밋 소진은 429다 — 400이 아니고, 문구에 200을 인용하지 않는다", async () => {
    // 즉답 레이트리밋이면 예산 안에서 3회를 다 쓰고 소진 경로로 나온다.
    const { attempts, error } = await runRateLimited(0);

    expect(attempts).toBe(3);
    expect(error?.status).toBe(429);
    // "KIS request failed: 200" — 상류의 HTTP 200을 실패 코드로 인용하던 문구
    expect(error?.message).not.toContain("200");
  }, 30_000);
});
