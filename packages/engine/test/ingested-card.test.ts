/**
 * B의 실제 POST /ingest 성공 산출물이 A 엔진의 단일 진입점을 통과하는지 확인한다.
 *
 * 같은 JSON은 Python의 test_hankook_two_pass.py가 JSON Schema·Pydantic·원문 좌표로
 * 검증한다. 여기서는 그 검증을 복제하지 않고, 저장된 실제 카드가 TypeScript 엔진에서
 * 스냅숏 픽스처로 교체되지 않은 채 RiskResult를 만드는 교차 경계만 고정한다.
 */
import { describe, expect, it } from "vitest";
import recorded from "../../../services/ingest/benchmarks/results/hankook_two_pass.json";
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
    expect(recorded.status).toBe("completed");
    expect(card.doc_version).toEqual({ review_no: "2026-0265" });
    expect(card.status).toBe("draft");
    expect(disposalDiscountRate(card)).toBe(0.15);
  });

  it("골든 계좌에서 D 30만·195주·4경로를 한 번의 조립으로 생성한다", () => {
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
