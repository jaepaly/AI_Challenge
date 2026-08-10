/**
 * 배포된 커밋의 신원.
 *
 * 왜 있느냐 — 배포가 조용히 뒤처지는 일이 두 번 있었다(#10 직후, #14 직후).
 * 두 번 다 "URL은 살아 있는데 옛 커밋을 서빙 중"이었고, 두 번 다 사람이
 * 화면에서 특정 문구를 찾아 헤매고 나서야 드러났다. 문구 찾기는 화면이
 * 바뀔 때마다 다시 정해야 하고, 아무도 안 열어보면 영영 안 드러난다.
 * SHA를 찍어두면 검증이 `푸터 SHA == main HEAD?` 한 번으로 끝난다.
 *
 * 서버 전용 — `VERCEL_GIT_COMMIT_SHA`는 `NEXT_PUBLIC_` 접두사가 없어서
 * 클라이언트 번들에 들어가지 않는다. 서버 컴포넌트/라우트 핸들러에서
 * 읽어 prop으로 내려보낼 것. Vercel이 자동 주입하므로 대시보드 설정은
 * 필요 없다.
 */
export type BuildInfo = {
  /** 전체 SHA. 로컬에선 빈 문자열 */
  sha: string;
  /** 화면에 찍는 7자리. 로컬에선 "local" */
  shortSha: string;
  /** 브랜치명. 로컬에선 "dev" */
  branch: string;
  /** vercel = 배포본, local = 개발 서버나 자체 호스팅 */
  source: "vercel" | "local";
};

/** 이 함수가 실제로 읽는 것만. `process.env` 전체를 받으면 테스트에서 캐스팅이 필요해진다 */
type BuildEnv = {
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  // 인덱스 시그니처가 없으면 전부-옵셔널 타입이라 weak type 판정에 걸려
  // process.env(= Dict<string>)를 못 받는다
  [key: string]: string | undefined;
};

export function readBuildInfo(env: BuildEnv = process.env): BuildInfo {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? "";
  const branch = env.VERCEL_GIT_COMMIT_REF ?? "";

  // SHA가 없으면 Vercel 빌드가 아니다. 빈 값을 "0000000"처럼 그럴듯하게
  // 채우지 않는다 — 모르는 것을 아는 척하면 계측을 붙인 의미가 없다.
  if (!sha) {
    return { sha: "", shortSha: "local", branch: branch || "dev", source: "local" };
  }

  return { sha, shortSha: sha.slice(0, 7), branch: branch || "unknown", source: "vercel" };
}
