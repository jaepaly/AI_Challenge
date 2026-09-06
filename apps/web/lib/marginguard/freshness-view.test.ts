import { describe, expect, it } from "vitest";
import { disposalDiscountRate } from "@marginguard/engine";
import { CARDS } from "./snapshot";
import { freshnessView, todayISO } from "./freshness-view";

const hantoo = CARDS.find((c) => c.key === "hantoo")!.card; // verified
const lower = CARDS.find((c) => c.key === "lower")!.card; // draft

/**
 * 날짜를 **카드에서 파생**한다. 2026-09-06 재검증에서 `verified_at` 을 올리자 이 파일의
 * 검사 4개가 깨졌다 — `"2026-08-09"` 를 «검증일 당일» 로, `"2026-09-09"` 를 «31일째» 로
 * 적어 두고 있었기 때문이다. 검사가 지키는 것은 *«검증일로부터 N일째의 화면»* 이지
 * *«2026-09-09 의 화면»* 이 아니다. `e2e/freshness.spec.ts` 가 먼저 이렇게 했다.
 */
const VERIFIED_AT = hantoo.verified_at!;
const dayAfter = (n: number) =>
  new Date(Date.parse(VERIFIED_AT) + n * 86_400_000).toISOString().slice(0, 10);

describe("todayISO", () => {
  it("로컬 날짜를 YYYY-MM-DD로 — 엔진이 verified_at에 요구하는 표기", () => {
    expect(todayISO(new Date(2026, 8, 9))).toBe("2026-09-09"); // 월은 0-based
    expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05"); // 한 자리 패딩
  });
});

describe("신선도 게이트 — 화면 규약", () => {
  it("검증일 당일은 계산 모드 — 배너 없음", () => {
    const v = freshnessView(hantoo, VERIFIED_AT);
    expect(v.verdict.reason).toBe("FRESH");
    expect(v.mode).toBe("calculated");
    expect(v.banner).toBeNull();
  });

  /**
   * 이 두 케이스가 A가 #10에서 지적한 시한폭탄이다 — 30일째까지 FRESH, 31일째부터 STALE.
   * 재검증 전에는 verified_at=2026-08-09 라 심사 3일차(9/9)에 여기 걸렸다.
   */
  it("30일째는 아직 계산 모드 — 허용 경계의 안쪽", () => {
    const v = freshnessView(hantoo, dayAfter(30));
    expect(v.verdict.ageDays).toBe(30);
    expect(v.mode).toBe("calculated");
  });

  it("31일째부터 강등 — 경과 일수를 문장에 싣는다", () => {
    const v = freshnessView(hantoo, dayAfter(31));
    expect(v.verdict.reason).toBe("STALE");
    expect(v.verdict.ageDays).toBe(31);
    expect(v.mode).toBe("blocked");
    expect(v.banner).toContain("31일 경과");
    expect(v.banner).toContain("재검증");
  });

  /**
   * DRAFT는 blocked가 아니다 — #30 리뷰에서 갈라진 지점.
   * ① types.ts:143이 RiskResult.cardStatus에 "draft면 배너 필수"를 적어뒀다.
   *    draft가 값을 못 낸다면 엔진 출력 타입이 그 필드를 가질 이유가 없다
   * ② 인제스트 출력의 status는 무조건 draft다(README §5-B) — 여기서 수량을 막으면
   *    라이브 인제스트 데모의 출력 화면이 "산정 불가"가 된다
   */
  it("draft는 차단이 아니라 참고 표시 — 값은 내고 배너를 붙인다", () => {
    const v = freshnessView(lower, "2026-08-09");
    expect(v.verdict.reason).toBe("DRAFT");
    expect(v.verdict.calculable).toBe(false); // 엔진 판정은 그대로
    expect(v.mode).toBe("reference"); // 화면은 값을 낸다
    expect(v.banner).toContain("검수 전(draft)");
    expect(v.banner).not.toContain("경과");
  });

  /**
   * 배너가 화면보다 많이 약속하면 안 된다.
   *
   * 원래 문구가 "정식 한계선 산출에 **사용하지 않습니다**"였는데 거짓이었다 —
   * `quantOk`가 `mode !== "blocked"`라 draft는 통과하고, 하한가형 카드의
   * h=0.3이 처분 수량을 만들어 같은 화면에 찍힌다. 팀원 외부 점검에서 발견됐다.
   *
   * 값을 내는 동작 자체는 #30에서 검토해 정한 것이라 그대로 둔다. 이 검사가 막는
   * 것은 **동작과 어긋나는 문구가 다시 들어오는 것**이다. 근거 없는 안심을 주지
   * 않는 것이 이 제품의 규율이고, 근거 없는 면책도 같은 종류다.
   */
  it("draft 배너가 '안 쓴다'고 말하지 않는다 — 실제로 그 카드로 계산한다", () => {
    const v = freshnessView(lower, "2026-08-09");

    // 이 카드는 실제로 수량 산출에 쓰인다 — h가 읽히고 blocked가 아니다
    expect(v.mode).not.toBe("blocked");
    expect(disposalDiscountRate(lower)).not.toBeNull();

    // 그러므로 배너가 비사용을 주장하면 안 된다
    expect(v.banner).not.toMatch(/사용하지\s*않/);
    expect(v.banner).not.toMatch(/쓰지\s*않습니다/);

    // 대신 값의 출처를 밝히고, 무엇이 아직 안 됐는지 말한다
    expect(v.banner).toContain("이 카드로 산출");
    expect(v.banner).toContain("대조");
  });

  it("blocked와 reference를 섞지 않는다 — 배너 문구가 사유를 구분한다", () => {
    const draft = freshnessView(lower, "2026-08-09");
    const stale = freshnessView(hantoo, dayAfter(31));
    expect([draft.mode, stale.mode]).toEqual(["reference", "blocked"]);
    expect(draft.banner).not.toContain("재검증");
    expect(stale.banner).toContain("재검증");
  });

  it("verified인데 검증일을 모르면 강등 — 모르는 것을 신선하다고 보지 않는다", () => {
    const noDate = { ...hantoo, verified_at: undefined };
    const v = freshnessView(noDate, "2026-08-09");
    expect(v.verdict.reason).toBe("NO_VERIFIED_AT");
    expect(v.mode).toBe("blocked");
    expect(v.banner).toContain("검증일");
  });

  /**
   * 배너가 말하는 허용 일수는 **엔진이 실제로 막는 경계**와 같아야 한다.
   * 리터럴이던 시절 이게 갈렸다 — 엔진 상수를 14로 바꿔 실측하니 게이트는 15일째부터
   * 막는데 배너는 "허용 30일"이라고 말했다(#56 리뷰). 상수를 읽어 비교하면 이 검사는
   * 무의미해지므로, **경계를 날짜별 호출로 직접 찾아** 배너 문구의 숫자와 대조한다.
   */
  it("배너가 말하는 허용 일수 = 게이트가 실제로 막기 시작하는 경계", () => {
    const base = "2026-01-01";
    const card = { ...hantoo, verified_at: base };
    const dayAfter = (n: number) =>
      new Date(Date.parse(base) + n * 86_400_000).toISOString().slice(0, 10);

    let lastCalculated = -1;
    for (let n = 0; n <= 400; n += 1) {
      if (freshnessView(card, dayAfter(n)).mode !== "calculated") break;
      lastCalculated = n;
    }
    expect(lastCalculated).toBeGreaterThan(0);

    const stale = freshnessView(card, dayAfter(lastCalculated + 1));
    expect(stale.verdict.reason).toBe("STALE");

    const claimed = stale.banner!.match(/허용 (\d+)일/);
    expect(claimed).not.toBeNull();
    expect(Number(claimed![1])).toBe(lastCalculated);
  });

  it("오염된 verified_at은 조용히 강등하지 않고 throw — 착시를 만들지 않는다", () => {
    expect(() => freshnessView({ ...hantoo, verified_at: "2026/08/09" }, "2026-08-09")).toThrow();
    expect(() => freshnessView(hantoo, dayAfter(-5))).toThrow(); // 미래 검증일
  });
});
