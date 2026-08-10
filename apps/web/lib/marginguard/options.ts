/**
 * 선택지 비교 — 해소 4경로 + 강제 처분 대조 (D)
 * ---------------------------------------------------------------------------
 * 이 파일에 산식은 없다. engine.resolutionPaths / liquidationQty가 낸 값을
 * **화면 표시 규약**에 맞춰 배열로 조립할 뿐이다.
 *
 * 되돌리면 안 되는 설계 결정 3개가 여기에 박혀 있다(HANDOFF §3):
 *  1. **1차 출력은 금액이다.** 수량은 보조이고 "산정 방식 재현값" 라벨을 뗄 수 없다.
 *     종목·수량·시점이 특정되면 매도 권유로 읽힌다.
 *  2. **추천하지 않는다.** 정렬은 고정 순서이며 "권장/최선" 같은 순위 표현을 넣지 않는다.
 *  3. **근거 없는 값을 만들지 않는다.** 대용증권 인정비율(α)이 카드에 없으면
 *     추정하지 않고 사유를 그대로 표시한다.
 */
import type { LiquidationResult, ResolutionPaths } from "@marginguard/engine";

export type OptionKey = "deposit" | "repay" | "collateral" | "voluntary";

export interface OptionRow {
  key: OptionKey;
  label: string;
  /** 1차 출력 — 필요 금액(원). 산정 불가면 null */
  amount: number | null;
  /** 보조 — 수량(주). 매도 경로에만 있고 항상 재현값 라벨과 함께 쓴다 */
  qty: number | null;
  /** 산식을 사람 말로 (근거 표시) */
  basis: string;
  /** amount가 null인 이유 — 있으면 화면이 이 문장을 그대로 보여준다 */
  unavailable?: string;
}

export interface ForcedRow {
  qty: number;
  /** 평가액 기준 처분 규모 = 수량 × 전일종가 */
  amount: number;
  mode: LiquidationResult["mode"];
  reason: LiquidationResult["reason"];
}

/**
 * 4경로를 고정 순서로 조립한다.
 * 순서는 "내가 돈을 넣는 것 → 내가 파는 것"이며 우열 순이 아니다.
 */
export function buildOptions(paths: ResolutionPaths, prevClose: number): OptionRow[] {
  return [
    {
      key: "deposit",
      label: "현금 입금",
      amount: paths.deposit,
      qty: null,
      basis: "부족액 D 전액",
    },
    {
      key: "repay",
      label: "융자 상환",
      amount: paths.repay,
      qty: null,
      basis: "D ÷ 담보유지비율 — 같은 부족액을 더 적은 현금으로 해소",
    },
    {
      key: "collateral",
      label: "대용증권 추가",
      amount: paths.collateral,
      qty: null,
      basis: "D ÷ 대용 인정비율",
      ...(paths.collateral === null
        ? { unavailable: "조건카드에 대용 인정비율이 없어 산정하지 않습니다" }
        : {}),
    },
    {
      key: "voluntary",
      label: "자발적 매도",
      amount: paths.voluntarySellQty === null ? null : paths.voluntarySellQty * prevClose,
      qty: paths.voluntarySellQty,
      basis: "제비용 반영 — 실제 매도라 실제 비용이 발생",
      ...(paths.voluntarySellQty === null
        ? { unavailable: "이 가격에서는 매도로 비율을 복원할 수 없습니다" }
        : {}),
    },
  ];
}

/** 강제 반대매매 — 대조군. 4경로와 같은 단위(금액)로 놓아야 대비가 보인다. */
export function forcedDisposal(liq: LiquidationResult, prevClose: number): ForcedRow {
  return {
    qty: liq.qty,
    amount: liq.qty * prevClose,
    mode: liq.mode,
    reason: liq.reason,
  };
}

/**
 * 사전 대응 대비 강제 처분이 몇 배인가.
 * 이 한 숫자가 화면의 결론이다 — "미리 알면 이만큼 덜 판다".
 * 자발적 매도가 불가하면(분모 없음) null.
 */
export function forcedToVoluntaryRatio(forced: ForcedRow, options: OptionRow[]): number | null {
  const v = options.find((o) => o.key === "voluntary");
  if (!v || v.amount === null || v.amount <= 0) return null;
  return forced.amount / v.amount;
}
