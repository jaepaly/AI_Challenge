/**
 * 랜딩 와이어프레임 — "주가를 이 선까지 끌어내려 보세요" (D · Phase 1)
 * ---------------------------------------------------------------------------
 * 원칙: 수치는 전부 packages/engine(결정론)에서 나온다. 이 파일은 렌더만 한다.
 *  - 임계가조차 직접 풀지 않는다 — engine.shortfall을 오라클로 이분 탐색.
 *  - 스냅숏 모드: KIS 미연동. 가상 골든 계좌(1,000주 × 전일종가, 융자 600만).
 *  - 7월 연쇄: 일자별 순차 적용으로 "1차 관통일" 탐지까지만. 집행(원장 갱신)을
 *    반영한 경로 시뮬은 A의 replay 엔진 완성 후 교체한다(README 5-A).
 */
import {
  equalShockLambda,
  liquidationQty,
  marginRatioPct,
  resolutionPaths,
  shortfall,
} from "../../../packages/engine/src/index";

/* ── 스냅숏 데이터 ──────────────────────────────────────────────── */

const ACCOUNT = { qty: 1_000, loan: 6_000_000, r: 1.4, cash: 0 };
const TICK = 10; // 호가단위(원) — 이 가격대 10원
const PRICE_MIN = 5_000;
const PRICE_MAX = 12_000;
const PRICE_START = 10_000;

interface CardPreset {
  key: string;
  broker: string;
  h: number;
  status: "verified" | "draft";
  source: string;
}
const CARDS: CardPreset[] = [
  { key: "hantoo", broker: "한국투자", h: 0.15, status: "verified", source: "신용거래설명서 심사필 제2026-0265호 · 골든 195주" },
  { key: "meritz", broker: "메리츠", h: 0.2, status: "verified", source: "신용거래설명서 심의필 제25-125호 · 교차검증 309주" },
  { key: "lower", broker: "하한가형(예시)", h: 0.3, status: "draft", source: "실측 카드 미확보 — k=−0.02 전량 폴백 시연용" },
];

/** 7월 연쇄 (KRX 확정치 8월 말 대조 예정 — data/golden todo와 동일 출처) */
const JULY_SEQ = [
  { label: "7/7", ret: -0.0491 },
  { label: "7/8", ret: -0.0535 },
  { label: "7/13", ret: -0.0895 },
  { label: "7/24", ret: -0.0572 },
  { label: "7/29", ret: -0.0598 },
];

/* ── 엔진 오라클 유틸 ───────────────────────────────────────────── */

const roundTick = (p: number) => Math.round(p / TICK) * TICK;

/** 임계가: engine.shortfall(V,L,r)=0이 되는 최소 가격 — 엔진을 오라클로 이분 탐색. */
function thresholdPrice(): number {
  let lo = PRICE_MIN / TICK;
  let hi = PRICE_MAX / TICK;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (shortfall(ACCOUNT.qty * mid * TICK, ACCOUNT.loan, ACCOUNT.r) === 0) hi = mid;
    else lo = mid + 1;
  }
  return lo * TICK;
}

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/* ── 상태 ───────────────────────────────────────────────────────── */

let price = PRICE_START;
let card = CARDS[0];
let replayTimer: number | null = null;

const $ = (id: string) => document.getElementById(id)!;
const P_STAR = thresholdPrice();

/* ── 렌더 ───────────────────────────────────────────────────────── */

function render() {
  const V = ACCOUNT.qty * price;
  const D = shortfall(V, ACCOUNT.loan, ACCOUNT.r);
  const breached = D > 0;

  // 슬라이더·가격
  ($("price") as HTMLInputElement).value = String(price);
  $("priceLabel").textContent = won(price);
  $("thresholdLabel").textContent = `임계가 ${won(P_STAR)}`;
  const pct = ((price - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
  $("priceBubble").style.left = `calc(${pct}% )`;
  $("priceBubble").textContent = won(price);
  document.body.dataset.state = breached ? "breach" : "safe";

  // ① 안전 여유 먼저 (기획서 4-2 표시 순서 규약)
  if (!breached) {
    const gapPct = (((price - P_STAR) / price) * 100).toFixed(1);
    $("headline").textContent = `임계가까지 여유 ${gapPct}%`;
    $("subline").textContent = `${won(price - P_STAR)} 더 하락하면 담보부족 계산이 시작됩니다`;
  } else {
    $("headline").textContent = `담보부족 ${won(D)}`;
    $("subline").textContent = "임계선을 지났습니다 — 아래는 약관 산정 방식의 재현값입니다";
  }

  // ② 담보비율 — 표시는 내림, 엔진 재현값(사사오입) 병기 [A·D 합의 안건]
  const shown = Math.floor((V * 100) / ACCOUNT.loan);
  const engine = marginRatioPct(V, ACCOUNT.loan);
  $("ratio").textContent = `${shown}%`;
  $("ratioNote").textContent =
    shown === engine ? `엔진 재현값 동일` : `엔진 재현값 ${engine}% (사사오입) — 표시 규약 합의 안건`;

  // ③ 처분 수량 (현재 카드 기준) + 회사 비교 스트립
  const liqBox = $("liqBox");
  if (breached) {
    liqBox.hidden = false;
    const liq = liquidationQty({ D, prevClose: price, r: ACCOUNT.r, h: card.h, held: ACCOUNT.qty });
    $("liqQty").textContent = liq.mode === "FULL" ? `전량 ${liq.qty.toLocaleString()}주` : `${liq.qty.toLocaleString()}주`;
    $("liqMode").textContent = liq.mode === "FULL" ? (liq.reason === "K_NON_POSITIVE" ? "전량 — k≤0, 부분 매도로 복원 불가" : "전량 — 필요 수량이 보유 초과") : `부분 처분 (k=${liq.k.toFixed(2)})`;
    $("liqMode").className = `mode ${liq.mode === "FULL" ? "full" : "partial"}`;

    for (const c of CARDS) {
      const el = $(`cmp-${c.key}`);
      const l = liquidationQty({ D, prevClose: price, r: ACCOUNT.r, h: c.h, held: ACCOUNT.qty });
      el.textContent = l.mode === "FULL" ? "전량" : `${l.qty.toLocaleString()}주`;
    }

    // ④ 해소 4경로 (f는 자발적 매도에만 — 제비용 0.8% 가정 표기)
    const paths = resolutionPaths({ D, r: ACCOUNT.r, prevClose: price, marketPrice: price, f: 0.008 });
    $("pDeposit").textContent = won(paths.deposit);
    $("pRepay").textContent = won(paths.repay);
    $("pSell").textContent = paths.voluntarySellQty === null ? "매도로 해소 불가" : `${paths.voluntarySellQty}주`;
  } else {
    liqBox.hidden = true;
  }

  // λ* (전 종목 균등 충격)
  const lam = equalShockLambda(V, ACCOUNT.loan, ACCOUNT.r, ACCOUNT.cash);
  $("lambda").textContent = lam === 0 ? "이미 관통" : lam === Infinity ? "—" : `−${(lam * 100).toFixed(1)}%`;

  // 카드 배너
  $("cardBanner").hidden = card.status !== "draft";
  $("cardSource").textContent = card.source;
  for (const c of CARDS) $(`card-${c.key}`).classList.toggle("active", c.key === card.key);
}

/* ── 7월 연쇄 재현 ──────────────────────────────────────────────── */

function playJuly() {
  if (replayTimer !== null) return;
  price = PRICE_START;
  let i = 0;
  let breachedAt: string | null = null;
  $("julyLog").textContent = "";
  ($("julyBtn") as HTMLButtonElement).disabled = true;
  render();
  replayTimer = window.setInterval(() => {
    if (i >= JULY_SEQ.length) {
      window.clearInterval(replayTimer!);
      replayTimer = null;
      ($("julyBtn") as HTMLButtonElement).disabled = false;
      $("julyLog").textContent += breachedAt ? ` → 1차 관통 ${breachedAt} (집행 반영 경로 시뮬은 엔진 replay 대기)` : " → 관통 없음";
      return;
    }
    const step = JULY_SEQ[i++];
    price = roundTick(price * (1 + step.ret));
    const D = shortfall(ACCOUNT.qty * price, ACCOUNT.loan, ACCOUNT.r);
    if (D > 0 && breachedAt === null) breachedAt = step.label;
    $("julyLog").textContent += `${step.label} ${(step.ret * 100).toFixed(2)}% → ${won(price)}${D > 0 ? " ⚠" : ""}   `;
    render();
  }, 750);
}

/* ── 바인딩 ─────────────────────────────────────────────────────── */

($("price") as HTMLInputElement).addEventListener("input", (e) => {
  price = roundTick(Number((e.target as HTMLInputElement).value));
  render();
});
$("julyBtn").addEventListener("click", playJuly);
for (const c of CARDS) {
  $(`card-${c.key}`).addEventListener("click", () => {
    card = c;
    render();
  });
}

render();
