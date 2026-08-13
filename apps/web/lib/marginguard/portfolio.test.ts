/**
 * 다종목 표시 규약 테스트 — 스냅숏 계좌 기준.
 * 값은 engine이 만들고 여기서는 **화면이 그 값을 어떻게 읽는지**를 고정한다.
 */
import { describe, expect, it } from "vitest";
import type { CreditLedger, Position } from "@marginguard/engine";
import { portfolioLambdaView, weakestRow } from "./portfolio";
import { PORTFOLIO_POSITIONS, portfolioLedger } from "./snapshot";

const led = portfolioLedger();

describe("λ 분해 — 스냅숏 계좌", () => {
  const view = portfolioLambdaView(PORTFOLIO_POSITIONS, led);

  it("평가액 1,000만 · 버퍼 160만 — λ*가 정확히 16.0%", () => {
    expect(view.V).toBe(10_000_000);
    expect(view.buffer).toBe(1_600_000); // 1,000만 − 1.4×600만
    expect(view.lambdaStarPct).toBe(16);
    expect(view.breached).toBe(false);
  });

  it("λ_k는 전부 λ*보다 크다 — 혼자 빠질 때가 함께 빠질 때보다 여유가 있다", () => {
    for (const r of view.rows) {
      expect(r.lambdaKPct).not.toBeNull();
      expect(r.lambdaKPct!).toBeGreaterThan(view.lambdaStarPct);
    }
  });

  it("종목별 λ_k — 비중이 클수록 작다", () => {
    const by = Object.fromEntries(view.rows.map((r) => [r.symbol, r.lambdaKPct]));
    expect(by.A0001).toBe(33.3); // 160만 / 480만 = 33.33…  → 내림
    expect(by.A0002).toBe(53.3); // 160만 / 300만 = 53.33…
    expect(by.A0003).toBe(72.7); // 160만 / 220만 = 72.72…
  });

  it("가장 취약한 종목은 비중이 가장 큰 갑 — 한계선 3분해 ②", () => {
    expect(weakestRow(view)!.symbol).toBe("A0001");
  });

  it("표시는 내림 — 여유를 올려 잡지 않는다", () => {
    // 33.333…%를 33.4%로 적으면 실제보다 더 버틴다고 말하는 것이다
    expect(view.rows.find((r) => r.symbol === "A0001")!.lambdaKPct).toBe(33.3);
  });

  it("종목번호 오름차순 — 처분 순서와 같은 정렬이다", () => {
    expect(view.rows.map((r) => r.symbol)).toEqual(["A0001", "A0002", "A0003"]);
  });
});

describe("경계", () => {
  it("λ_k ≥ 1이면 퍼센트를 적지 않는다 — 0원이 돼도 안 뚫리는 종목", () => {
    const pos: Position[] = [
      { symbol: "A0001", name: "큰 종목", qty: 900, prevClose: 10_000, group: "일반" },
      { symbol: "A0002", name: "작은 종목", qty: 10, prevClose: 10_000, group: "일반" },
    ];
    // V=910만, rL=1.4×500만=700만 → 버퍼 210만. 작은 종목 평가액 10만 < 210만
    const view = portfolioLambdaView(pos, { loan: 5_000_000, cash: 0, requiredRatio: 1.4 });
    const small = view.rows.find((r) => r.symbol === "A0002")!;
    expect(small.immune).toBe(true);
    expect(small.lambdaKPct).toBeNull(); // "2100%"라고 적으면 거짓말이 된다
    expect(weakestRow(view)!.symbol).toBe("A0001"); // immune은 후보에서 빠진다
  });

  it("보유 0인 종목은 산정하지 않는다 — 캡할 큰 값이 아니라 부재다", () => {
    const pos: Position[] = [
      { symbol: "A0001", name: "남은 종목", qty: 400, prevClose: 12_000, group: "일반" },
      { symbol: "A0002", name: "전량 처분됨", qty: 0, prevClose: 10_000, group: "일반" },
    ];
    const view = portfolioLambdaView(pos, led);
    const gone = view.rows.find((r) => r.symbol === "A0002")!;
    expect(gone.lambdaKPct).toBeNull();
    expect(gone.immune).toBe(false); // 면역이 아니라 미산정 — 둘을 섞으면 안 된다
  });

  it("이미 관통한 계좌는 λ*가 0이고 λ_k도 전부 0이다", () => {
    const view = portfolioLambdaView(PORTFOLIO_POSITIONS, {
      loan: 9_000_000, // rL=1,260만 > V=1,000만
      cash: 0,
      requiredRatio: 1.4,
    });
    expect(view.breached).toBe(true);
    expect(view.lambdaStarPct).toBe(0);
    for (const r of view.rows) expect(r.lambdaKPct).toBe(0);
  });

  it("정수 스케일 — r×L을 부동소수로 곱하지 않는다", () => {
    // 1.4 × 5,500,000 = 7,699,999.999999999 (naive float). 버퍼가 1원 어긋나면
    // λ가 어긋나고, 방향은 여유 과대 = 낙관이다
    const ledger: CreditLedger = { loan: 5_500_000, cash: 0, requiredRatio: 1.4 };
    const view = portfolioLambdaView(
      [{ symbol: "A0001", name: "종목", qty: 1_000, prevClose: 10_000, group: "일반" }],
      ledger,
    );
    expect(view.buffer).toBe(2_300_000); // 1,000만 − 770만. 7,699,999.99…가 아니다
  });
});
