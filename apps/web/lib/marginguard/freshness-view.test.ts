import { describe, expect, it } from "vitest";
import { CARDS } from "./snapshot";
import { freshnessView, todayISO } from "./freshness-view";

const hantoo = CARDS.find((c) => c.key === "hantoo")!.card; // verified, verified_at=2026-08-09
const lower = CARDS.find((c) => c.key === "lower")!.card; // draft

describe("todayISO", () => {
  it("로컬 날짜를 YYYY-MM-DD로 — 엔진이 verified_at에 요구하는 표기", () => {
    expect(todayISO(new Date(2026, 8, 9))).toBe("2026-09-09"); // 월은 0-based
    expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05"); // 한 자리 패딩
  });
});

describe("신선도 게이트 — 화면 규약", () => {
  it("검증일 당일은 계산 모드 — 배너 없음", () => {
    const v = freshnessView(hantoo, "2026-08-09");
    expect(v.verdict.reason).toBe("FRESH");
    expect(v.quantitative).toBe(true);
    expect(v.banner).toBeNull();
  });

  /**
   * 이 두 케이스가 A가 #10에서 지적한 시한폭탄이다.
   * verified_at=2026-08-09 + 30일 = 9/8까지 FRESH, 9/9(31일째)부터 STALE.
   * 심사 기간이 9/7~9/11이라 3일차부터 참고 모드로 강등된다.
   */
  it("심사 2일차(9/8, 30일째)는 아직 계산 모드", () => {
    const v = freshnessView(hantoo, "2026-09-08");
    expect(v.verdict.ageDays).toBe(30);
    expect(v.quantitative).toBe(true);
  });

  it("심사 3일차(9/9, 31일째)부터 강등 — 경과 일수를 문장에 싣는다", () => {
    const v = freshnessView(hantoo, "2026-09-09");
    expect(v.verdict.reason).toBe("STALE");
    expect(v.verdict.ageDays).toBe(31);
    expect(v.quantitative).toBe(false);
    expect(v.banner).toContain("31일 경과");
    expect(v.banner).toContain("재검증");
  });

  it("draft 카드는 신선도와 무관하게 강등되고 사유가 다르다", () => {
    const v = freshnessView(lower, "2026-08-09");
    expect(v.verdict.reason).toBe("DRAFT");
    expect(v.quantitative).toBe(false);
    expect(v.banner).toContain("검수 전(draft)");
    expect(v.banner).not.toContain("경과");
  });

  it("verified인데 검증일을 모르면 강등 — 모르는 것을 신선하다고 보지 않는다", () => {
    const noDate = { ...hantoo, verified_at: undefined };
    const v = freshnessView(noDate, "2026-08-09");
    expect(v.verdict.reason).toBe("NO_VERIFIED_AT");
    expect(v.quantitative).toBe(false);
    expect(v.banner).toContain("검증일");
  });

  it("오염된 verified_at은 조용히 강등하지 않고 throw — 착시를 만들지 않는다", () => {
    expect(() => freshnessView({ ...hantoo, verified_at: "2026/08/09" }, "2026-08-09")).toThrow();
    expect(() => freshnessView(hantoo, "2026-08-01")).toThrow(); // 미래 검증일
  });
});
