import { describe, expect, it } from "vitest";
import { readBuildInfo } from "./build-info";

describe("readBuildInfo — 배포 신원", () => {
  it("Vercel 환경: SHA 앞 7자리와 브랜치를 읽는다", () => {
    const info = readBuildInfo({
      VERCEL_GIT_COMMIT_SHA: "f27a9723c0de1234567890abcdef1234567890ab",
      VERCEL_GIT_COMMIT_REF: "main",
    });

    expect(info).toEqual({
      sha: "f27a9723c0de1234567890abcdef1234567890ab",
      shortSha: "f27a972",
      branch: "main",
      source: "vercel",
    });
  });

  it("로컬: SHA가 없으면 'local'로 표시하고 가짜 SHA를 지어내지 않는다", () => {
    const info = readBuildInfo({});

    expect(info.source).toBe("local");
    expect(info.shortSha).toBe("local");
    expect(info.sha).toBe(""); // "0000000" 같은 그럴듯한 값 금지
    expect(info.branch).toBe("dev");
  });

  it("프리뷰 배포: 브랜치가 main이 아니어도 그대로 노출한다", () => {
    // 프리뷰 URL을 프로덕션으로 착각하는 사고를 막는 건 브랜치명이다
    const info = readBuildInfo({
      VERCEL_GIT_COMMIT_SHA: "abc1234def",
      VERCEL_GIT_COMMIT_REF: "feat/d-npm-lockfile",
    });

    expect(info.branch).toBe("feat/d-npm-lockfile");
    expect(info.source).toBe("vercel");
  });

  it("SHA는 있는데 브랜치가 없으면 'unknown' — 브랜치 자리를 비워두지 않는다", () => {
    const info = readBuildInfo({ VERCEL_GIT_COMMIT_SHA: "abc1234def" });

    expect(info.branch).toBe("unknown");
    expect(info.source).toBe("vercel");
  });
});
