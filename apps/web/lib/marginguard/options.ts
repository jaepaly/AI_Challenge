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
  /** 캡 이전의 필요 수량. mode=FULL이면 이 값이 보유수량을 넘는다(k≤0이면 null) */
  rawQty: number | null;
}

/**
 * 4경로를 고정 순서로 조립한다.
 * 순서는 "내가 돈을 넣는 것 → 내가 파는 것"이며 우열 순이 아니다.
 */
export function buildOptions(
  paths: ResolutionPaths,
  prevClose: number,
  /** 보유수량 — 자발적 매도가 물리적으로 가능한지 판정하는 데만 쓴다 */
  held: number,
): OptionRow[] {
  // engine.resolutionPaths가 held를 받지 않아 보유수량을 넘는 매도 수량을 낸다(이슈 #19).
  // 엔진 수정 전까지의 임시 방어 — 산식이 아니라 비교 한 번이다.
  // 엔진이 null을 돌려주게 되면 이 가드는 중복이 되지만 그대로 둔다(이중 방어).
  const volQty = paths.voluntarySellQty;
  const volOverHeld = volQty !== null && volQty > held;

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
      amount: volQty === null || volOverHeld ? null : volQty * prevClose,
      qty: volQty === null || volOverHeld ? null : volQty,
      basis: "제비용 반영 — 실제 매도라 실제 비용이 발생",
      ...(volQty === null
        ? { unavailable: "이 가격에서는 매도로 비율을 복원할 수 없습니다" }
        : volOverHeld
          ? {
              unavailable: `보유 ${held.toLocaleString()}주를 전부 팔아도 부족액이 남습니다 — 매도만으로는 해소되지 않습니다`,
            }
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
    rawQty: liq.rawQty,
  };
}

/**
 * 화면의 결론 한 줄. **배수는 항상 낼 수 있는 값이 아니다.**
 *
 * 배수(강제 ÷ 자발)가 성립하려면 두 값이 같은 성질이어야 한다. 전량 처분에는
 * **성질이 다른 두 가지**가 있고 여기서 갈린다.
 *
 *  - `K_NON_POSITIVE` — k≤0이라 부분 매도로는 비율 복원이 불가능해 약관이 전량을
 *    지시한다. 캡이 아니라 **규정된 결과**다. 배수는 그대로 의미가 있다(하한가형 10.4배).
 *  - `QTY_EXCEEDED` — 필요 수량이 보유를 넘어 **보유수량에서 잘린 값**이다. 분자만
 *    캡되고 분모는 안 캡되니 비는 실제보다 **작게** 나온다 — 낙관 방향이다.
 *    6,000원에서 0.97배까지 내려가 "아무것도 안 하는 쪽이 덜 판다"는 거짓을 화면이
 *    말하게 된다(이슈 #19). 뒤집히지 않는 구간(6,100원 1.03배)에서도 과소평가는 같다.
 *
 * 그래서 `QTY_EXCEEDED`면 배수를 내지 않고 **무슨 일이 벌어지는지를 문장으로** 돌려준다.
 * 이쪽이 사실이면서 더 세다 — "전량을 팔고도 부족액이 남는다"가 "1.03배"보다 무겁다.
 */
export type ComparisonVerdict =
  /** 부분 처분 — 배수가 의미를 갖는 유일한 경우 */
  | { kind: "ratio"; ratio: number }
  /** 필요 수량이 보유 초과라 강제는 전량으로도 부족 — 자발적 매도로는 아직 해소 가능 */
  | { kind: "forced_capped"; voluntaryQty: number; held: number }
  /** 전량을 팔아도 해소 불가 — 남는 것은 잔여채무뿐 */
  | { kind: "unresolvable"; held: number };

export function comparisonVerdict(
  forced: ForcedRow,
  options: OptionRow[],
  held: number,
): ComparisonVerdict {
  const v = options.find((o) => o.key === "voluntary");
  const voluntaryOk = !!v && v.amount !== null && v.amount > 0 && v.qty !== null;

  if (!voluntaryOk) return { kind: "unresolvable", held };
  if (forced.reason === "QTY_EXCEEDED") {
    return { kind: "forced_capped", voluntaryQty: v.qty!, held };
  }
  return { kind: "ratio", ratio: forced.amount / v.amount! };
}
