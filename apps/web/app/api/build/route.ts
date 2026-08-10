import { NextResponse } from "next/server";
import { readBuildInfo } from "@/lib/build-info";

/**
 * 배포 신선도 점검용. `curl -s <URL>/api/build | jq -r .shortSha` 가
 * main HEAD와 같은지만 보면 된다.
 *
 * W5 무중단 리허설의 헬스체크가 "URL이 200을 준다"에서 멈추면 안 되는 이유:
 * 옛 커밋을 서빙하는 배포도 200을 준다. 살아 있는 것과 올바른 것은 다르다.
 */
export const dynamic = "force-dynamic"; // 빌드 시점에 굳혀서 캐시되면 안 된다

export function GET() {
  return NextResponse.json(readBuildInfo(), {
    headers: { "cache-control": "no-store" },
  });
}
