/**
 * 다종목 표시 규약 (D)
 * ---------------------------------------------------------------------------
 * 이 파일에 산식은 없다. engine.equalShockLambda / singleAssetLambda가 낸 값을
 * **화면이 어떻게 읽어야 하는지**만 정한다.
 *
 * 두 한계선은 묻는 질문이 다르다.
 *  - λ*  (균등충격) "전 종목이 동시에 몇 % 빠지면 관통하는가"
 *  - λ_k (종목 단독) "이 종목 혼자 몇 % 빠지면 관통하는가 — 나머지가 그대로일 때"
 *
 * λ_k는 **반사실 가정 위의 지표다.** 실제로는 종목들이 함께 움직이므로 λ_k만 보고
 * 안심하면 안 된다. 그래서 화면은 둘을 **나란히** 놓고, λ*를 먼저 읽게 한다.
 */
import { equalShockLambda, singleAssetLambda } from "@marginguard/engine";
import type { CreditLedger, Position } from "@marginguard/engine";

export interface LambdaRow {
  symbol: string;
  name: string;
  qty: number;
  prevClose: number;
  /** 평가액 = 보유 × 전일종가 */
  value: number;
  /** 주식 평가액 대비 비중(%, 내림) */
  weightPct: number;
  /**
   * 이 종목 단독 한계선(%, 내림). null이면 산정하지 않는다.
   * 내림인 이유: 여유를 올려 잡으면 낙관이다. 33.37%는 33.3%로 적는다.
   */
  lambdaKPct: number | null;
  /** λ_k ≥ 1 — 이 종목이 0원이 돼도 관통하지 않는다. 퍼센트로 적으면 거짓말이 된다 */
  immune: boolean;
}

export interface PortfolioLambdaView {
  /** 주식 평가액 + 현금성 담보 */
  V: number;
  /** 버퍼 B = V − r·L. 0 이하면 이미 관통 */
  buffer: number;
  /** 전 종목 균등 하락 한계선(%, 내림). 이미 관통이면 0 */
  lambdaStarPct: number;
  breached: boolean;
  rows: LambdaRow[];
}

/** 내림 1자리 퍼센트 — 여유를 올려 잡지 않는다 */
function floorPct(lambda: number): number {
  return Math.floor(lambda * 1000) / 10;
}

export function portfolioLambdaView(
  positions: Position[],
  ledger: CreditLedger,
): PortfolioLambdaView {
  const stock = positions.reduce((s, p) => s + p.qty * p.prevClose, 0);
  const V = stock + ledger.cash;
  const buffer = V - Math.round(ledger.requiredRatio * 100) * ledger.loan / 100;
  const breached = buffer <= 0;

  const lambdaStar = equalShockLambda(V, ledger.loan, ledger.requiredRatio, ledger.cash);

  const rows: LambdaRow[] = positions.map((p) => {
    const value = p.qty * p.prevClose;
    // 보유 0이면 "이 종목 혼자 하락한다"는 가정 자체가 성립하지 않는다(#23 규약).
    // 캡할 큰 값이 아니라 부재다 — 0으로 나눠 Infinity가 새면 화면에 그대로 찍힌다.
    const lk = p.qty > 0 ? singleAssetLambda(V, ledger.loan, ledger.requiredRatio, p.qty, p.prevClose) : null;
    return {
      symbol: p.symbol,
      // Position.name은 선택 필드다. 없으면 종목번호를 그대로 쓴다 — 빈칸으로 두면
      // 표에서 어느 행인지 알 수 없다
      name: p.name ?? p.symbol,
      qty: p.qty,
      prevClose: p.prevClose,
      value,
      weightPct: stock > 0 ? Math.floor((value * 1000) / stock) / 10 : 0,
      lambdaKPct: lk === null || lk >= 1 ? null : floorPct(lk),
      immune: lk !== null && lk >= 1,
    };
  });

  return {
    V,
    buffer,
    lambdaStarPct: Number.isFinite(lambdaStar) ? floorPct(lambdaStar) : 100,
    breached,
    rows: [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

/**
 * 가장 취약한 종목 = λ_k가 가장 작은 것. 한계선 3분해의 ②가 이 한 줄이다.
 * immune(0원이 돼도 안 뚫림)과 산정 불가는 후보에서 뺀다.
 */
export function weakestRow(view: PortfolioLambdaView): LambdaRow | null {
  const candidates = view.rows.filter((r) => r.lambdaKPct !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((min, r) => (r.lambdaKPct! < min.lambdaKPct! ? r : min));
}
