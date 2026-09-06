import { describe, it, expect } from "vitest";
import { readiness, kstToday } from "./readiness";
import { CARDS } from "./snapshot";

/**
 * 이 검사들이 지키는 것은 하나다 — **심사 5일(9/7~9/11)이 전부 초록인가.**
 *
 * 처음엔 반대였다. #54가 실측한 «9/9~9/11 이 막힌다» 를 못박아 두고 *"이 구간에서
 * 초록이면 검사가 가짜다"* 라고 적었다. 2026-09-06 재검증으로 `verified_at` 을 올리자
 * 그 검사들이 전부 깨졌다 — 당연하다, 결함이 고쳐졌으니까. 그래서 두 층으로 갈랐다.
 *
 *   ① 심사 창(9/7~9/11)은 **절대 날짜**로 초록을 요구한다 — 제출물의 약속이다
 *   ② 게이트가 살아 있다는 것은 **카드에서 파생한 날짜**로 잰다 — 검증일이 바뀌어도 따라온다
 *
 * ①이 빨간불이면 재검증이 안 된 것이고, ②가 빨간불이면 게이트가 죽은 것이다.
 */

/** KST 자정 = UTC 전날 15:00 */
const kstMidnight = (iso: string) => new Date(`${iso}T00:00:00+09:00`);

const VERIFIED_AT = CARDS.find((p) => p.card.status === "verified")!.card.verified_at!;
const dayAfter = (n: number) =>
  new Date(Date.parse(VERIFIED_AT) + n * 86_400_000).toISOString().slice(0, 10);
/** 31일째 — 30일까지 허용이므로 여기서 처음 막힌다 */
const FIRST_BLOCKED = dayAfter(31);

describe("판정 기준일 — 심사위원 시간대(KST)", () => {
  it("서버가 UTC여도 KST 날짜로 판정한다", () => {
    // 이 순간 UTC는 9/8, KST는 9/9다. 화면(브라우저 로컬)이 보는 것은 9/9다.
    expect(kstToday(new Date("2026-09-08T15:30:00Z"))).toBe("2026-09-09");
  });

  it("UTC 날짜를 쓰면 놓치는 9시간이 실재한다 — 그 방향이 낙관이라 더 나쁘다", () => {
    // 30일째 UTC 15:30 = 31일째 KST 00:30. 경계를 카드에서 파생해 재검증에 안 밀린다.
    const moment = new Date(`${dayAfter(30)}T15:30:00Z`);
    expect(moment.toISOString().slice(0, 10)).toBe(dayAfter(30)); // 서버가 볼 날짜
    expect(kstToday(moment)).toBe(FIRST_BLOCKED); // 심사위원이 볼 날짜
    // 전자로 판정하면 blocked를 fresh라고 말한다.
    expect(readiness(moment).ok).toBe(false);
  });
});

describe("심사 기간 5일 — 2026-09-06 재검증 뒤 전부 초록이어야 한다", () => {
  // #54 실측 당시(verified_at 08-09)엔 9/9~9/11 이 false 였다. 그 사실을 여기 못박아
  // 두었다가 재검증으로 뒤집혔다 — 이 표는 이제 «제출물이 약속한 창» 이다.
  const table = [
    ["2026-09-07", true],
    ["2026-09-08", true],
    ["2026-09-09", true],
    ["2026-09-10", true],
    ["2026-09-11", true],
  ] as const;

  for (const [day, ok] of table) {
    it(`${day} → ok=${ok}`, () => {
      expect(readiness(kstMidnight(day)).ok).toBe(ok);
    });
  }

  it("심사 창이 첫 차단일보다 앞에 있다 — 표의 true 다섯 개가 우연이 아니다", () => {
    expect(Date.parse("2026-09-11")).toBeLessThan(Date.parse(FIRST_BLOCKED));
  });

  it("막히는 날에는 어느 카드가 문제인지 이름으로 말한다", () => {
    const r = readiness(kstMidnight(FIRST_BLOCKED));
    expect(r.degraded.length).toBeGreaterThan(0);
    for (const label of r.degraded) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("draft 카드는 degraded가 아니다", () => {
  it("설계상 항상 참고 모드인 카드를 빨간불로 세지 않는다", () => {
    const r = readiness(kstMidnight(VERIFIED_AT));
    const drafts = r.cards.filter((c) => c.status === "draft");
    expect(drafts.length).toBeGreaterThan(0); // 하한가형이 draft다
    for (const c of drafts) {
      expect(c.mode).toBe("reference");
      expect(c.degraded).toBe(false);
    }
    // 그리고 그 카드들 때문에 전체가 빨간불이 되지 않는다
    expect(r.ok).toBe(true);
  });
});

describe("예보 — 지금 초록이어도 언제 뒤집히는지 말한다", () => {
  it("검증일 당일에 다음 차단일과 남은 일수를 낸다", () => {
    const r = readiness(kstMidnight(VERIFIED_AT));
    expect(r.ok).toBe(true);
    expect(r.nextBlockedAt).toBe(FIRST_BLOCKED);
    expect(r.daysUntilBlocked).toBe(31);
  });

  it("심사 첫날(9/7)의 예보가 심사 창 너머를 가리킨다 — #54 의 반대 상태", () => {
    // 재검증 전엔 이 자리의 답이 "2026-09-09 / 3일" 이었다. 그 예보가 있었으면 #54 를
    // 사람이 찾을 필요가 없었고, 지금은 같은 예보가 «창은 덮였다» 를 말한다.
    // 조회일은 창 안(9/7)이다 — 9/6 으로 두면 09-07 재검증에서 «미래 검증일» 이 되어
    // 층 ① 검사가 뮤테이션에 헛되이 걸린다(실제로 걸렸다).
    const r = readiness(kstMidnight("2026-09-07"));
    expect(r.ok).toBe(true);
    expect(Date.parse(r.nextBlockedAt!)).toBeGreaterThan(Date.parse("2026-09-11"));
  });

  it("이미 지난 카드에는 예보를 달지 않는다 — 없는 날짜를 지어내지 않는다", () => {
    const r = readiness(kstMidnight(dayAfter(32)));
    const blocked = r.cards.filter((c) => c.mode === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const c of blocked) expect(c.blockedFrom).toBeNull();
  });
});

describe("만료일을 상수로 베끼지 않는다", () => {
  it("예보는 freshnessView를 실제로 호출해 찾은 값이다", () => {
    // verified_at + 31일이 차단일이라는 것을 카드 자체에서 재확인한다.
    // 엔진의 30일 상수가 바뀌면 이 검사가 아니라 예보가 따라 움직여야 한다.
    const verified = CARDS.filter((p) => p.card.status === "verified");
    expect(verified.length).toBeGreaterThan(0);
    const r = readiness(kstMidnight(VERIFIED_AT));
    for (const p of verified) {
      const row = r.cards.find((c) => c.label === p.label);
      const at = p.card.verified_at;
      if (row?.blockedFrom == null || at == null) continue;
      const gap = (Date.parse(row.blockedFrom) - Date.parse(at)) / 86_400_000;
      expect(gap).toBe(31); // 30일까지 허용 → 31일째 차단
    }
  });
});
