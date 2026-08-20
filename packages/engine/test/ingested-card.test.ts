/**
 * B의 4차 POST /ingest 성공 산출물을 동결한 픽스처가 A 엔진의 단일 진입점을
 * 통과하는지 확인한다.
 *
 * 벤치마크 정본은 재실행 시 합법적으로 바뀔 수 있으므로 엔진 테스트에서 직접 import하지
 * 않는다. 여기서 확인하는 경계는 카드의 h·status이며, 유지비율 r은 아직 원장
 * requiredRatio에서 읽는다. ratio_rules 소비는 별도 랜딩 결선 과제다.
 */
import { describe, expect, it } from "vitest";
import recorded from "./fixtures/hankook-ingest-fourth-success.json";
import { assembleRiskResult, disposalDiscountRate } from "../src/index";
import type { ConditionCard, CreditLedger, Position } from "../src/index";

const card = recorded.card as unknown as ConditionCard;
const positions: Position[] = [
  {
    symbol: "000001",
    name: "가상 종목",
    qty: 1_000,
    prevClose: 8_100,
    group: "전체",
  },
];
const ledger: CreditLedger = {
  loan: 6_000_000,
  cash: 0,
  requiredRatio: 1.4,
};

describe("실제 한투 인제스트 카드 → RiskResult", () => {
  it("저장된 4차 성공 카드를 수정 없이 읽어 h=0.15와 draft 상태를 보존한다", () => {
    expect(recorded.recorded_status).toBe("completed");
    expect(card.doc_version).toEqual({ review_no: "2026-0265" });
    expect(card.status).toBe("draft");
    expect(disposalDiscountRate(card)).toBe(0.15);
  });

  it("카드 h·status와 원장 r을 조립해 D 30만·195주·4경로를 생성한다", () => {
    expect(card.ratio_rules[0]?.ratio).toBe(1.4);
    expect(ledger.requiredRatio).toBe(1.4);
    const result = assembleRiskResult({
      positions,
      ledger,
      card,
      f: 0.008,
      asOf: "2026-08-17",
    });

    expect(result).toMatchObject({
      shortfall: 300_000,
      marginRatioPct: 135,
      liquidation: { mode: "PARTIAL", qty: 195, k: 0.19 },
      paths: {
        deposit: 300_000,
        repay: 214_286,
        collateral: null,
        voluntarySellQty: 96,
      },
      equalShockLambda: 0,
      cardStatus: "draft",
    });
    expect(result.liquidationSkipped).toBeUndefined();
  });
});
