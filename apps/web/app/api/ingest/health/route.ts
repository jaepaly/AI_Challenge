import { NextResponse } from "next/server";
import { checkAnthropicModelsHealth } from "@/lib/ingest/anthropic-health";
import { readIngestUploadFaultInjection } from "@/lib/ingest/upload-fault";

/**
 * 상류(Anthropic) 도달 확인. **무인 폴링 대상이 아니다** — README §5-C.
 *
 * 폴링은 `/api/build`(어느 커밋인가)와 `/api/readiness`(답을 내는가) 둘로 한다.
 * 이 엔드포인트는 사람이 손으로 확인할 때만 쓴다.
 *
 * ## 왜 캐시하나
 *
 * 인증이 없고 심사 기간에 URL이 공개된다. 히트마다 상류로 나가면:
 *
 *   1. **레이트리밋 슬롯을 먹는다.** 우리 키의 한도를 남이 소모하면 정작
 *      심사위원 업로드가 429로 막힌다. 무중단 요건에 직결된다
 *   2. **함수 슬롯을 점유한다.** 히트당 최대 5초(상류 타임아웃)
 *   3. 키가 살아 있는지 아무나 확인할 수 있다
 *
 * ⚠ **토큰 과금은 없다.** `/v1/models`는 모델 목록 조회라 추론 호출이 아니다.
 *    이건 비용 항목이 아니라 **가용성 항목**이다 — 그래서 W5 묶음에 들어간다.
 *
 * 60초 캐시는 `no-store`를 걷어내는 대신 **모듈 스코프 메모이제이션**으로 한다.
 * CDN 캐시는 서버리스 인스턴스 앞단이라 상류 호출 자체를 막지 못하는 경우가 있고,
 * 우리가 줄이려는 건 응답 시간이 아니라 **상류로 나가는 요청 수**이기 때문이다.
 *
 * ⚠ 인스턴스마다 독립이라 N개면 분당 N회까지 나간다. 서버리스 공유 상태가
 *    없어 완전히는 못 막는다 — #31 P2-a와 같은 한계다. 그래도 무제한보다 낫다.
 *
 * ## faultInjected
 *
 * `INGEST_UPLOAD_FAULT`가 프로덕션에 남으면 업로드가 참고 모드로 강등되는데,
 * 그 화면이 **크레딧 소진과 구분되지 않는다.** 주입 상태를 여기서 드러내
 * 리허설이 "강등이 의도된 것인지"를 판별할 수 있게 한다.
 */
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;

type Cached = { at: number; result: Awaited<ReturnType<typeof checkAnthropicModelsHealth>> };
let cache: Cached | null = null;

/** 테스트 전용 — 인스턴스 간 상태가 새지 않도록 명시적으로 비운다. */
export function __resetHealthCacheForTests() {
  cache = null;
}

export async function GET() {
  const now = Date.now();
  const hit = cache !== null && now - cache.at < CACHE_TTL_MS ? cache : null;
  const entry: Cached = hit ?? { at: now, result: await checkAnthropicModelsHealth() };
  cache = entry;

  const fault = readIngestUploadFaultInjection();

  return NextResponse.json(
    {
      ...entry.result,
      // 이 응답이 상류를 새로 물어본 것인지 캐시인지 밝힌다. 밝히지 않으면
      // 리허설이 "60초 내내 같은 값"을 상류 안정으로 오독한다.
      cached: hit !== null,
      ageSeconds: Math.round((now - entry.at) / 1000),
      faultInjected: fault?.fault ?? null,
    },
    {
      status: entry.result.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
