import { describe, it, expect } from "vitest";
import { readiness, kstToday } from "./readiness";
import { CARDS } from "./snapshot";

/**
 * 이 검사들이 지키는 것은 하나다 — **심사 사흘(9/9~9/11)이 실제로 잡히는가.**
 *
 * #54에서 실측한 구간이다. `/api/build`는 그 사흘 내내 200에 올바른 sha를 준다.
 * 준비도 검사가 이 구간에서 초록이면 검사가 가짜다.
 */

/** KST 자정 = UTC 전날 15:00 */
const kstMidnight = (iso: string) => new Date(`${iso}T00:00:00+09:00`);

describe("판정 기준일 — 심사위원 시간대(KST)", () => {
  it("서버가 UTC여도 KST 날짜로 판정한다", () => {
    // 이 순간 UTC는 9/8, KST는 9/9다. 화면(브라우저 로컬)이 보는 것은 9/9다.
    expect(kstToday(new Date("2026-09-08T15:30:00Z"))).toBe("2026-09-09");
  });

  it("UTC 날짜를 쓰면 놓치는 9시간이 실재한다 — 그 방향이 낙관이라 더 나쁘다", () => {
    const moment = new Date("2026-09-08T15:30:00Z");
    expect(moment.toISOString().slice(0, 10)).toBe("2026-09-08"); // 서버가 볼 날짜
    expect(kstToday(moment)).toBe("2026-09-09"); // 심사위원이 볼 날짜
    // 전자로 판정하면 blocked를 fresh라고 말한다.
    expect(readiness(moment).ok).toBe(false);
  });
});

describe("심사 기간 5일 — #54가 실측한 구간을 잡는가", () => {
  const table = [
    ["2026-09-07", true],
    ["2026-09-08", true],
    ["2026-09-09", false],
    ["2026-09-10", false],
    ["2026-09-11", false],
  ] as const;

  for (const [day, ok] of table) {
    it(`${day} → ok=${ok}`, () => {
      expect(readiness(kstMidnight(day)).ok).toBe(ok);
    });
  }

  it("막히는 날에는 어느 카드가 문제인지 이름으로 말한다", () => {
    const r = readiness(kstMidnight("2026-09-09"));
    expect(r.degraded.length).toBeGreaterThan(0);
    for (const label of r.degraded) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("draft 카드는 degraded가 아니다", () => {
  it("설계상 항상 참고 모드인 카드를 빨간불로 세지 않는다", () => {
    const r = readiness(kstMidnight("2026-08-19"));
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
  it("8/19 시점에 다음 차단일과 남은 일수를 낸다", () => {
    const r = readiness(kstMidnight("2026-08-19"));
    expect(r.ok).toBe(true);
    expect(r.nextBlockedAt).toBe("2026-09-09");
    expect(r.daysUntilBlocked).toBe(21);
  });

  it("이 예보가 있었으면 #54를 사람이 찾을 필요가 없었다", () => {
    // 심사 시작 하루 전에도 이미 사흘 뒤 차단을 알고 있다
    const r = readiness(kstMidnight("2026-09-06"));
    expect(r.ok).toBe(true);
    expect(r.nextBlockedAt).toBe("2026-09-09");
    expect(r.daysUntilBlocked).toBe(3);
  });

  it("이미 지난 카드에는 예보를 달지 않는다 — 없는 날짜를 지어내지 않는다", () => {
    const r = readiness(kstMidnight("2026-09-10"));
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
    const r = readiness(kstMidnight("2026-08-19"));
    for (const p of verified) {
      const row = r.cards.find((c) => c.label === p.label);
      const at = p.card.verified_at;
      if (row?.blockedFrom == null || at == null) continue;
      const gap = (Date.parse(row.blockedFrom) - Date.parse(at)) / 86_400_000;
      expect(gap).toBe(31); // 30일까지 허용 → 31일째 차단
    }
  });
});
