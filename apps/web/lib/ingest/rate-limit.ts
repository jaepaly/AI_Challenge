/**
 * 업로드 쿼터 — **돈이 나가는 엔드포인트**라 KIS 쪽과 용도가 다르다.
 * ---------------------------------------------------------------------------
 * `lib/kis/rate-limit.ts` 는 상류(KIS)를 우리 버스트로부터 지키는 **직렬 큐**다.
 * 여기서 막아야 하는 것은 그게 아니라 **우리 크레딧**이다. 업로드 1건이 약 311~416원
 * (한투 **실행** 2건, 표준 정가 환산)이고 심사 기간에 URL 이 인증 없이 공개된다.
 *
 * ⚠ 원화는 **실측이 아니다.** 잰 것은 토큰과 시간이고, 원화는 거기에 가격표를 곱한
 *   값이다(B 지적). Console 실청구와 대조된 적은 아직 없다.
 *
 * ⚠ 한도를 정할 때는 **비싼 쪽(416원)** 으로 잡는다. 최신 실행이 311원이라고 그 값으로
 *   잡으면 실제 청구가 예상을 넘는 날이 온다 — 예산 가드에서 낙관은 그대로 초과다.
 *   근거: `benchmarks/results/hankook_two_pass.json`(416.00원) ·
 *   `…attempt8_success.json`(310.93원).
 *
 * ⚠ **이것은 비용의 마지막 방어선이 아니다.** 서버리스는 인스턴스마다 메모리가
 *   따로라 카운터가 공유되지 않고, 인스턴스가 새로 뜨면 0 부터 시작한다. N 개면
 *   실질 한도가 N 배다(`/api/ingest/health` 의 60초 메모이제이션과 같은 한계).
 *
 *   **절대 상한은 Anthropic Console 의 spend limit 이다**(docs/team-handbook.md §8 하드 가드 ①).
 *   그게 걸리면 상류가 거절하고 `upload-fault.ts` 의 강등 경로가 받는다. 여기 있는
 *   것은 *"심사위원이 버튼을 연타했을 때"* 를 막는 것이고, 그 이상을 주장하지 않는다.
 *
 * 두 축을 함께 본다. IP 는 바꾸기 쉬우므로 **전역 한도가 실제 상한**이다.
 */

/** IP 하나가 한 시간에 쓸 수 있는 횟수. 심사위원 한 명이 서너 번 눌러 보는 것을 상정한다. */
export const PER_CLIENT_LIMIT = 3;
/** 인스턴스 하나가 한 시간에 허용하는 총량. IP 를 바꿔 가며 부르는 것을 여기서 받는다. */
export const GLOBAL_LIMIT = 12;
export const WINDOW_MS = 60 * 60 * 1000;

/** 키가 무한히 쌓이지 않게 한다 — 서버리스라도 인스턴스는 오래 산다. */
const MAX_TRACKED_CLIENTS = 5_000;

const hits = new Map<string, number[]>();
let globalHits: number[] = [];

/** 테스트 전용 — 인스턴스 간 상태가 새지 않도록 명시적으로 비운다. */
export function __resetUploadQuotaForTests(): void {
  hits.clear();
  globalHits = [];
}

const prune = (stamps: number[], now: number) => stamps.filter((at) => now - at < WINDOW_MS);

export interface QuotaVerdict {
  allowed: boolean;
  /** 거절했을 때만 — 창이 열릴 때까지 남은 초 */
  retryAfterSeconds?: number;
  /** 어느 축에서 걸렸는가. 화면 문구를 가르는 데 쓴다 */
  scope?: "client" | "global";
}

/**
 * ⚠ **부수효과가 있다.** 허용하면 그 자리에서 카운트를 올린다.
 *
 * 검사와 기록을 나누면 그 사이에 두 요청이 통과한다. 나누고 싶어지면 먼저
 * "왜 나누는가"를 적어라 — 지금 구조에서는 나눌 이유가 없다.
 */
export function takeUploadSlot(clientKey: string, now: number = Date.now()): QuotaVerdict {
  globalHits = prune(globalHits, now);
  if (globalHits.length >= GLOBAL_LIMIT) {
    return {
      allowed: false,
      scope: "global",
      retryAfterSeconds: Math.ceil((WINDOW_MS - (now - globalHits[0]!)) / 1000),
    };
  }

  const mine = prune(hits.get(clientKey) ?? [], now);
  if (mine.length >= PER_CLIENT_LIMIT) {
    hits.set(clientKey, mine);
    return {
      allowed: false,
      scope: "client",
      retryAfterSeconds: Math.ceil((WINDOW_MS - (now - mine[0]!)) / 1000),
    };
  }

  if (!hits.has(clientKey) && hits.size >= MAX_TRACKED_CLIENTS) {
    // 가장 오래된 키를 버린다. Map 은 삽입 순서를 지킨다.
    const oldest = hits.keys().next();
    if (!oldest.done) hits.delete(oldest.value);
  }
  mine.push(now);
  hits.set(clientKey, mine);
  globalHits.push(now);
  return { allowed: true };
}

/**
 * 클라이언트 식별자. **신뢰 경계가 아니다** — 헤더는 위조된다.
 *
 * Vercel 이 앞단에서 `x-forwarded-for` 를 채우므로 첫 항목이 실제 클라이언트에
 * 가장 가깝다. 못 읽으면 하나의 공용 키로 묶는다 — 그러면 그 무리 전체가 IP 축
 * 한도를 나눠 쓴다. **모르는 것을 관대하게 다루지 않는다.**
 */
export function clientKeyFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}
