/**
 * 골든 테스트 — 한국투자증권 신용거래 설명서 공식 예시 + 타사 교차검증.
 * 이 파일의 기대값은 증권사 공개 자료에서 나온 "정답지"다.
 * 실패하면 코드를 고치는 것이지, 기대값을 고치는 게 아니다.
 * (기대값 변경은 원문 출처 첨부 + A 포함 2인 승인 필수)
 */
import { describe, it, expect } from "vitest";
import {
  shortfall,
  restorationCoefficient,
  liquidationQty,
  disposalAmount,
  residualDebt,
  marginRatioPct,
  resolutionPaths,
  equalShockLambda,
  leveragedEntryLambda,
} from "../src/index";

describe("골든 — 한국투자 공식 설명서", () => {
  it("case2: V 810만·L 600만 → D 30만 / 195주 / 처분 136.5만 / 배수 4.55", () => {
    const D = shortfall(8_100_000, 6_000_000, 1.4);
    expect(D).toBe(300_000);

    const liq = liquidationQty({ D, prevClose: 8_100, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.mode).toBe("PARTIAL");
    expect(liq.qty).toBe(195);
    expect(liq.k).toBe(0.19);

    // 체결가 7,000원은 설명서의 가정치 — 처분금액 계산에만 쓰이고 수량 산정엔 미관여
    const amount = disposalAmount(liq.qty, 7_000);
    expect(amount).toBe(1_365_000);
    expect(amount / D).toBeCloseTo(4.55, 2);
  });

  it("case1: V 615만 → n_raw 1,926 > 보유 1,000 → 전량 / 잔여채무 70만 / 총손실 470만", () => {
    const D = shortfall(6_150_000, 6_000_000, 1.4);
    expect(D).toBe(2_250_000);

    const liq = liquidationQty({ D, prevClose: 6_150, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.mode).toBe("FULL");
    expect(liq.reason).toBe("QTY_EXCEEDED");
    expect(liq.rawQty).toBe(1_926);
    expect(liq.qty).toBe(1_000);

    // 체결가 5,300원은 설명서의 가정치
    const debt = residualDebt(6_000_000, disposalAmount(1_000, 5_300));
    expect(debt).toBe(700_000);
    // 총손실 = 초기 자기자본 400만(진입 시 V=1,000만, L=600만) 전손 + 잔여채무
    expect(4_000_000 + debt).toBe(4_700_000);
  });

  it("담보비율 시리즈: 167 / 142 / 138 / 121 / 103 % (120.5→121, 102.5→103 사사오입 포함)", () => {
    const L = 6_000_000;
    const series = [10_000_000, 8_500_000, 8_300_000, 7_230_000, 6_150_000];
    expect(series.map((V) => marginRatioPct(V, L))).toEqual([167, 142, 138, 121, 103]);
  });
});

describe("교차검증 — 산정 기준가(h)의 회사별 편차", () => {
  it("메리츠형 h=0.20 → k=0.12 → 309주 (같은 계좌가 회사만 다르면 195→309주)", () => {
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.2, held: 1_000 });
    expect(liq.mode).toBe("PARTIAL");
    expect(liq.qty).toBe(309);
    expect(liq.k).toBe(0.12);
  });

  it("하한가형 h=0.30 → k=−0.02 ≤ 0 → 부분 매도로 복원 불가, 전량 처분 폴백", () => {
    expect(restorationCoefficient(1.4, 0.3)).toBe(-0.02);
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.3, held: 1_000 });
    expect(liq.mode).toBe("FULL");
    expect(liq.reason).toBe("K_NON_POSITIVE");
    expect(liq.qty).toBe(1_000);
  });

  it("회귀 방지: k에 제비용 f를 섞으면 195주가 206주로 깨진다 — 과거 오류의 기록", () => {
    // 틀린 식 k' = r(1−h)(1−f) − 1 → 206주. f는 미수·자발매도 산식 전용이다.
    const wrongK = 1.4 * (1 - 0.15) * (1 - 0.008) - 1;
    expect(Math.ceil(300_000 / (8_100 * wrongK))).toBe(206);
    // 올바른 식은 195주
    const liq = liquidationQty({ D: 300_000, prevClose: 8_100, r: 1.4, h: 0.15, held: 1_000 });
    expect(liq.qty).toBe(195);
  });
});

describe("해소 4경로", () => {
  it("같은 D=30만: 입금 30만 / 상환 21.5만(−28.6%) / 자발 매도 96주", () => {
    const p = resolutionPaths({
      D: 300_000,
      r: 1.4,
      prevClose: 8_100,
      marketPrice: 8_100,
      f: 0.008,
    });
    expect(p.deposit).toBe(300_000);
    expect(p.repay).toBe(214_286); // ceil(300,000 / 1.4)
    expect(p.voluntarySellQty).toBe(96); // 강제 195주 대비 절반 — 사전 대응의 가격
    expect(p.collateral).toBeNull(); // α 미지정
  });
});

describe("한계선 (진입 전 / 보유 중)", () => {
  it("진입 전 λ* = 1 − r(1−g): g 40/45/50% → 16/23/30% 하락까지 생존", () => {
    expect(leveragedEntryLambda(0.4)).toBeCloseTo(0.16, 10);
    expect(leveragedEntryLambda(0.45)).toBeCloseTo(0.23, 10);
    expect(leveragedEntryLambda(0.5)).toBeCloseTo(0.3, 10);
  });

  it("균등충격 λ*: V 1,000만·L 600만 → 16% (g=40% 진입과 교차 일치)", () => {
    expect(equalShockLambda(10_000_000, 6_000_000, 1.4)).toBeCloseTo(0.16, 10);
  });

  it("버퍼 소진(B≤0) 계좌는 λ*=0 — 골든 계좌 V 810만은 이미 관통 상태", () => {
    expect(equalShockLambda(8_100_000, 6_000_000, 1.4)).toBe(0);
  });
});
