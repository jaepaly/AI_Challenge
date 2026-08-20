import { NextResponse } from "next/server";
import { readBuildInfo } from "@/lib/build-info";
import { readiness } from "@/lib/marginguard/readiness";

/**
 * W5 무중단 리허설의 폴링 대상. **제품이 답을 내는가**를 본다.
 *
 * `/api/build`는 "어느 커밋이 떠 있나"까지만 답한다. 그것으로는 #54가 실측한
 * 구간을 못 본다 — 스냅숏 카드가 2026-09-09부터 blocked라 심사 사흘(9/9~9/11)
 * 동안 화면이 "산정 불가"인데 `/api/build`는 내내 200에 올바른 sha를 준다.
 *
 *   `/api/build`     서버가 살아 있나 + 어느 커밋인가
 *   `/api/readiness` 그 커밋이 실제로 답을 내나          ← 이 파일
 *
 * 두 개를 다 폴링한다. 하나로 합치지 않는 이유는 `/api/build`가 배포 신선도
 * 판별에 이미 쓰이고 있어서, 준비도 판정이 그 계약을 흔들면 안 되기 때문이다.
 *
 * **Anthropic API를 호출하지 않는다.** 신선도 판정은 순수 계산이다. 그래서
 * 무인 폴링 대상으로 삼아도 비용이 0이다 — `/api/ingest/health`는 히트마다
 * 상류로 나가므로 폴링하면 안 된다(README §5-C).
 *
 * 리허설이 이 검사가 실제로 발화하는지 확인할 때는 `?at=` 로 미래 시점을 준다:
 *
 *     curl -s '<URL>/api/readiness?at=2026-09-09T00:00:00%2B09:00' | jq .ok
 *     → false 여야 한다. true면 이 검사가 가짜다.
 *
 * ⚠ 무인 폴링은 `?at=`을 **붙이지 않는다.** 붙이면 감시가 아니라 시뮬레이션이 된다.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const at = new URL(request.url).searchParams.get("at");

  let now = new Date();
  if (at !== null) {
    const parsed = Date.parse(at);
    if (Number.isNaN(parsed)) {
      return NextResponse.json(
        { ok: false, error: "at은 파싱 가능한 날짜/시각이어야 합니다", at },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    now = new Date(parsed);
  }

  const report = readiness(now);

  return NextResponse.json(
    { ...report, build: readBuildInfo(), simulated: at !== null },
    {
      // 준비도는 날짜가 바뀌는 순간 뒤집힌다. 캐시하면 그 순간을 놓친다.
      status: report.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
