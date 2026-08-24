"use client";

/**
 * 랜딩 — "주가를 이 선까지 끌어내려 보세요" (D)
 * ---------------------------------------------------------------------------
 * 원칙: 이 파일에 산식이 없다. 모든 수치는 @marginguard/engine이 낸다.
 *  - 임계가조차 직접 풀지 않고 engine.shortfall을 오라클로 이분 탐색한다.
 *  - 7월 연쇄는 engine.replay()가 낸 ReplayStep[]을 그대로 렌더한다(집행·원장 갱신 포함).
 *  - 담보비율 3단 규칙(PR #2 합의): 판정=원시값(engine) / 골든 재현=사사오입 / 표시=내림.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  equalShockLambda,
  liquidationQty,
  marginRatioPct,
  replay,
  replayPortfolio,
  resolutionPaths,
  shortfall,
  type PortfolioReplayStep,
  type ReplayStep,
  disposalDiscountRate,
} from "@marginguard/engine";
import { freshnessView, todayISO } from "../lib/marginguard/freshness-view";
import { ratioView } from "../lib/marginguard/ratio-view";
import type { BuildInfo } from "../lib/build-info";
import UploadPanel from "./upload-panel";
import { policyRatio } from "@marginguard/engine";
import type { CardPreset } from "../lib/marginguard/snapshot";
import {
  buildOptions,
  comparisonVerdict,
  forcedDisposal,
  fullDisposalLabel,
} from "../lib/marginguard/options";
import EvidencePanel from "./evidence-panel";
import OptionsCompare from "./options-compare";
import PortfolioView from "./portfolio-view";
import { evidenceView } from "../lib/marginguard/evidence-view";
import { portfolioLambdaView, weakestRow } from "../lib/marginguard/portfolio";
import {
  ACCOUNT,
  ASSUMED_FEE_RATE,
  CARDS,
  JULY_SEQ,
  PORTFOLIO_POSITIONS,
  portfolioJuly,
  portfolioLedger,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_START,
  TICK,
  displayRatio,
  ledger,
  positions,
  roundTick,
  won,
} from "../lib/marginguard/snapshot";

/**
 * 임계가 = engine.shortfall이 0이 되는 최소 가격. 엔진을 오라클로 이분 탐색.
 *
 * ⚠ `r` 을 **인자로 받는다.** 전에는 `ACCOUNT.requiredRatio` 리터럴을 읽었고, 그래서
 *   카드를 바꿔도 임계가가 안 움직였다 — *"AI 가 약관을 읽고 엔진이 계산한다"* 가
 *   이 줄에서 성립하지 않았다(#67 A-1).
 */
function thresholdPrice(r: number): number {
  let lo = Math.floor(PRICE_MIN / TICK);
  let hi = Math.floor(PRICE_MAX / TICK);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (shortfall(ACCOUNT.qty * mid * TICK, ACCOUNT.loan, r) === 0) hi = mid;
    else lo = mid + 1;
  }
  return lo * TICK;
}

export default function Landing({ build }: { build: BuildInfo }) {
  const [price, setPrice] = useState(PRICE_START);
  const [cardKey, setCardKey] = useState(CARDS[0]!.key);
  /**
   * 업로드로 만든 카드. 하나만 들고 있는다 — 여러 장을 쌓으면 화면이 "내가 올린 것들"의
   * 목록이 되는데, 이 제품이 답하려는 질문은 그게 아니다.
   */
  const [uploaded, setUploaded] = useState<CardPreset | null>(null);
  const cards = uploaded ? [...CARDS, uploaded] : CARDS;
  const [steps, setSteps] = useState<ReplayStep[] | null>(null);
  const [cursor, setCursor] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 재생 중 여부는 state로 둔다 — ref를 렌더에서 읽으면 버튼 disabled가 갱신되지 않는다 */
  const [playing, setPlaying] = useState(false);
  const [pfSteps, setPfSteps] = useState<PortfolioReplayStep[] | null>(null);
  const [pfCursor, setPfCursor] = useState(-1);
  const pfTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pfPlaying, setPfPlaying] = useState(false);

  /**
   * 신선도 판정 기준일 — **열람 시각**이다. 빌드 시각으로 하면 우리가 막으려는
   * 실패를 못 잡는다: 9/6 재검증을 잊고 배포하면 배포일 기준 28일이라 FRESH이고,
   * 9/9이 되어도 배포본은 계속 28일이라고 믿는다. 열람 시각이면 31일로 잡힌다.
   * SSR 하이드레이션 불일치를 피해 useEffect에서 넣는다 — 판정 전(null)에는
   * 기본 가격이 안전 구간이라 처분 박스가 렌더되지 않아 깜빡임이 없다.
   */
  const asOf = useSyncExternalStore<string | null>(
    () => () => {},              // 구독 없음 — 시계는 렌더 시점에 읽는다
    () => todayISO(new Date()),  // 클라이언트 스냅숏 (같은 날이면 같은 문자열 → 재렌더 없음)
    () => null,                  // 서버 스냅숏 — SSR에서는 판정하지 않는다
  );

  // 업로드 카드가 지워지는 경우는 없지만(하나만 들고 대체한다), find 가 못 찾으면
  // 첫 프리셋으로 되돌린다 — 화면이 죽는 것보다 낫다.
  const preset = cards.find((c) => c.key === cardKey) ?? CARDS[0]!;
  const h = disposalDiscountRate(preset.card);
  const hUnknown = h === null; // 조건카드 불완전 — 수량을 추정하지 않는다

  /** 신선도 게이트 — 판정은 엔진, 화면 규약은 lib/marginguard/freshness-view */
  const fresh = asOf ? freshnessView(preset.card, asOf) : null;
  /**
   * 유지비율 대조 게이트 — 판정은 엔진(ratioAgreement), 화면 규약은 lib/marginguard/ratio-view.
   *
   * ⚠ **asOf에 묶지 않는다.** r 비교는 시계와 무관하다 — 신선도처럼 useSyncExternalStore
   *   경로에 얹으면 SSR 첫 페인트에서 표식이 사라진다.
   * ⚠ **breached에 묶지 않는다.** 원장 r이 낡아 관통이 안 잡히는 구간이 어긋남이 가장
   *   위험한 자리다(원장 1.2 · 카드 1.4 · 7,300원 → 원장 기준 D=0인데 카드 기준이면
   *   D=1,100,000). 그래서 배너는 아래 #cardBanner 옆에서 관통과 무관하게 뜬다.
   *
   * 종목군은 포지션에서 온다 — 카드가 종목군별로 다른 유지비율을 실어 오면 그중 어느
   * 조항이 이 계좌에 걸리는지가 그것으로 좁혀진다. 가격은 대조에 관여하지 않으므로
   * 슬라이더를 끌어도 이 값은 변하지 않는다(포지션을 넘기는 것은 종목군 때문이다).
   */
  const pos = positions(price)[0]!;
  /**
   * **계산용 유지비율은 카드가 정한다**(#67 A-1, (다) 채택). 못 정하면 숫자를 내지 않는다 —
   * 원장 리터럴로 메우면 그 순간 (다)가 아니고, 화면이 어디서 온지 모르는 숫자를
   * 근거 옆에 놓는다.
   */
  const policy = policyRatio(preset.card, pos);
  const r = policy.resolved ? policy.ratio : Number.NaN;
  const led = ledger(preset.card);
  /**
   * 유지비율 대조 게이트(#55) — 판정은 엔진(ratioAgreement), 화면 규약은 ratio-view.
   *
   * ⚠ **합성 계좌에서는 구조적으로 항상 통과한다.** `led.requiredRatio` 가 같은 카드에서
   *   파생되므로 카드를 자기 자신과 맞대 본다. 이건 게이트를 무력화한 것이 아니라
   *   **비교할 두 번째 값이 없다는 사실**이다 — 가상 계좌에는 "브로커가 이 계좌에
   *   적용하는 실제 비율"이 없다. 리터럴 1.4 를 제2 의견인 척 두면 오히려 실제 약관
   *   대부분을 차단한다(실측: 1.5·1.2·1.05 전부 차단).
   *
   *   실계좌가 붙으면 `ledger()` 가 진짜 원장을 싣고, 이 게이트는 **그 자리에서 의미를
   *   되찾는다.** 그래서 배선을 지운 것이 아니라 남겨 둔다.
   *
   *   지금 실질적으로 막는 것은 `policy.resolved === false` 다 — 카드가 이 계좌에 대해
   *   r 을 하나로 못 정하는 경우(메리츠 '일반' 처럼 종목군이 안 좁혀지는 자리).
   */
  const ratio = ratioView(preset.card, led.requiredRatio, pos);
  /**
   * 수량·배수를 낼 수 있는가.
   * draft는 **낸다**(참고 모드 라벨만) — 인제스트 출력이 무조건 draft이므로
   * 여기서 막으면 라이브 데모의 출력 화면이 "산정 불가"가 된다(#30 리뷰).
   * 막는 것은 blocked(STALE·NO_VERIFIED_AT)와 h 부재, 그리고 유지비율 어긋남뿐이다.
   */
  /**
   * ⚠ `policy.resolved` 가 **맨 앞**이다. 카드가 r 을 하나로 못 정하면 부족액·임계가·λ*
   *   까지 전부 못 낸다 — 수량만의 문제가 아니다. 다른 사유는 그 다음이다.
   */
  const quantOk =
    policy.resolved && !hUnknown && fresh?.mode !== "blocked" && ratio.confirmed;
  /**
   * 수량을 못 내는 사유 — 계기판과 선택지 비교가 같은 문장을 쓴다(두 곳에 쓰면 갈라진다).
   *
   * 유지비율 어긋남을 **맨 앞**에 둔다. 엔진의 liquidationSkipped 우선순위와 같은
   * 이유다 — 이 사유만 다른 사유의 전제를 무너뜨린다. r을 하나로 맞추지 못한 상태에서
   * "재검증하면 수량이 나온다"고 말하면 사용자를 헛수고로 보낸다(재검증 배너는
   * fresh.banner가 이 사유와 무관하게 따로 낸다 — 정보는 사라지지 않는다).
   * ※ 아래 두 사유의 상대 순서는 손대지 않았다. 엔진은 CARD_NOT_FRESH를 먼저 말하고
   *   화면은 h 부재를 먼저 말하는 기존 어긋남이 있으나, 이 PR의 범위 밖이다.
   */
  const quantBlockReason = quantOk
    ? null
    : !policy.resolved
      ? policy.why === "AMBIGUOUS"
        ? `이 조건카드는 이 계좌에 걸리는 유지비율을 하나로 정하지 못합니다 — 후보가 ${policy.candidates.map((c) => `${Math.round(c * 100)}%`).join(" · ")}입니다. 종목군을 특정해야 계산할 수 있습니다`
        : policy.why === "NO_RULE"
          ? "이 조건카드에는 담보유지비율 조항이 없습니다 — 계산의 기준값이 없습니다"
          : "이 조건카드의 유지비율을 숫자로 읽지 못했습니다 — 값을 지어내지 않습니다"
      : (ratio.blockReason ??
      (hUnknown
        ? "조건카드에 산정 기준가 규칙(할인율)이 없습니다 — 처분 수량을 추정하지 않습니다"
        : "이 카드는 재검증이 필요합니다 — 낡은 값을 정식 산출로 내지 않습니다"));
  /**
   * ⚠ **useMemo 를 걷어냈다.** 전에는 `useMemo(..., [])` 였고, 빈 배열이라 카드를 바꿔도
   *   임계가가 안 움직였다 — 그게 정확히 (다)가 고치는 결함의 모양이다. `[r]` 로 고치자
   *   React Compiler 가 *"Existing memoization could not be preserved"* 로 거부했다.
   *
   *   이분 탐색은 13회 반복이라 메모할 이유가 없다. 컴파일러와 다투는 대신 지운다 —
   *   **손으로 건 메모가 틀린 의존성으로 버그를 만든 자리**이기도 하다.
   */
  const pStar = thresholdPrice(r);

  /**
   * 근거 좌표 뷰모델. **신선도 게이트를 걸지 않는다** — 근거는 h 유래 파생값이 아니라
   * 문서 사실이고, blocked는 "왜 계산을 못 하나"를 묻는 화면이라 재검증하러 가려면
   * 어느 판본의 어느 문장인지가 오히려 더 필요하다(freshness-view.ts:55-59).
   *
   * **가리지 않는 것과 만료를 숨기는 것은 다르다.** 그래서 판정(fresh)은 패널에
   * 넘긴다 — 넘기지 않으면 blocked 화면에서 "이 카드는 재검증이 필요합니다" 바로
   * 아래에 근거 머리글이 calculated일 때와 바이트 단위로 같은 검수 표시를 낸다.
   *
   * useMemo를 걸지 않는다 — 순수 조립(문자열 라벨링)이라 비용이 없고, React Compiler가
   * `[preset.card]`를 `preset`으로 추론해 수동 메모이제이션을 보존하지 못한다며
   * 이 컴포넌트의 최적화를 통째로 건너뛴다(react-hooks/preserve-manual-memoization).
   *
   * ratio.applicableRule을 넘기는 이유: 이 패널은 카드의 유지비율을 좌표·해시와 함께
   * 크게 찍는데, 그 자리를 `ratio_rules[0]`으로 고정하면 룰이 여럿인 카드에서
   * **게이트와 화면이 서로 다른 조항을 본다.** 실측(카드 [대주 1.7, 융자 1.4] ·
   * 원장 1.4): 게이트는 융자 140으로 통과해 배너도 행 문구도 뜨지 않는데 패널은
   * 좌표를 달고 170%를 찍어, 이 PR이 없애려던 "근거 있는 170% + 140%로 낸 부족액"이
   * 무표식으로 복원된다. 반대 방향에서는 행 문구가 "옆 값 170%"라고 쓰는데 옆에
   * 찍힌 값이 120%가 된다. 상세는 evidence-view.ts의 evidenceView 머리글.
   */
  const evidence = evidenceView(preset.card, ratio.applicableRule ?? undefined);

  // 언마운트 시 재현 타이머 정리
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (pfTimer.current) clearInterval(pfTimer.current);
    },
    [],
  );

  /* ── 엔진 산출 ─────────────────────────────────────────────── */
  const V = ACCOUNT.qty * price;
  const D = shortfall(V, ACCOUNT.loan, r);
  const breached = D > 0;

  const liq =
    breached && h !== null
      ? liquidationQty({ D, prevClose: price, r, h, held: ACCOUNT.qty })
      : null;
  const paths = breached
    ? resolutionPaths({
        D,
        r,
        prevClose: price,
        marketPrice: price,
        f: ASSUMED_FEE_RATE,
        // held를 넘겨야 엔진이 '전량 팔아도 해소 불가'를 null로 판정한다(#21).
        // 안 넘기면 1,005·1,029·1,749주 같은 불가능한 수량이 그대로 나온다(#19).
        held: ACCOUNT.qty,
      })
    : null;
  // 조립은 한 번만 — 이전에는 JSX에서 buildOptions/forcedDisposal을 각각 두 번 불러
  // 같은 입력으로 두 벌을 만들고 있었다(결론과 카드가 어긋날 수 있는 구조)
  const optionRows = paths ? buildOptions(paths, price, ACCOUNT.qty) : null;
  const forcedRow = liq ? forcedDisposal(liq, price) : null;
  const verdict =
    optionRows && forcedRow ? comparisonVerdict(forcedRow, optionRows, ACCOUNT.qty) : null;

  const lambda = equalShockLambda(V, ACCOUNT.loan, r, ACCOUNT.cash);

  const shown = displayRatio(V, ACCOUNT.loan); // 표시 = 내림
  const engineRatio = marginRatioPct(V, ACCOUNT.loan); // 골든 재현 = 사사오입

  // 회사별 비교도 카드마다 게이트를 건다 — 선택된 카드만 막고 비교 행에 수량을
  // 남기면, 같은 카드가 한 화면에서 "산정 불가"와 "전량"을 동시에 말하게 된다
  /**
   * ⚠ **업로드 카드는 여기 넣지 않는다.** `cards` 가 아니라 `CARDS` 다.
   *
   * 이 스트립은 *"같은 부족액, 회사만 다를 때"* 인데, 배너는 **선택된** 카드가 draft 일
   * 때만 뜬다. verified 카드를 보고 있어도 스트립은 draft 유래 수치를 경고 없이
   * 표시하는 결함이 이미 있고(A 가 #66 리뷰에서 찾았다, `#70` D-5), 업로드 카드를
   * 얹으면 **그 결함을 넓히는 것**이 된다 — 업로드 카드는 정의상 항상 draft 다.
   *
   * `#64` P0-3(draft 계산 차단 여부)이 정해지면 그 결정에 맞춰 함께 손댄다.
   */
  const compare = CARDS.map((c) => {
    const ch = disposalDiscountRate(c.card);
    // 유지비율 대조도 카드마다 건다 — 비교 행은 **같은 부족액**에 회사만 갈아 끼운
    // 것이라, 어떤 카드의 r이 그 부족액을 만든 r과 어긋나면 그 행의 수량만 틀린다.
    // 선택된 카드만 막고 비교 행을 남기면 화면이 한 자리에서 두 말을 하게 된다.
    //
    // ⚠ 대조 상대가 `led.requiredRatio`(= **선택된 카드가 정한 r**)다. (다) 이후로
    //   이 대조는 오히려 **의미가 생겼다** — 전에는 모두가 리터럴 1.4와 비교돼
    //   세 프리셋이 전부 통과했고(셋 다 1.4), 그래서 아무것도 안 잡았다.
    const cRatio = ratioView(c.card, led.requiredRatio, pos);
    const cBlocked = asOf !== null && freshnessView(c.card, asOf).mode === "blocked";
    const ok = ch !== null && !cBlocked && cRatio.confirmed;
    /**
     * 이 행이 빠진 **사유**. 캡션이 "같은 부족액, 회사만 다를 때"라고 단언하는데,
     * 사유 없는 "산정 불가"만 놓이면 사용자는 그것을 그 회사의 산정 방식 특성으로
     * 읽는다 — 실제 이유가 유지비율 충돌이어도 그렇다. 선택된 카드가 멀쩡하면
     * #ratioBanner도 .evRatioGap도 뜨지 않아 화면 어디에도 사유가 남지 않는다.
     * 우선순위는 quantBlockReason과 같게 둔다(유지비율 → h 부재 → 재검증).
     */
    const why = ok
      ? null
      : !cRatio.confirmed
        ? cRatio.blockReason
        : ch === null
          ? "조건카드에 산정 기준가 규칙(할인율)이 없습니다 — 처분 수량을 추정하지 않습니다"
          : "이 카드는 재검증이 필요합니다 — 낡은 값을 정식 산출로 내지 않습니다";
    return {
      key: c.key,
      label: c.label,
      unusable: !ok,
      why,
      qty:
        breached && ok
          ? liquidationQty({ D, prevClose: price, r, h: ch, held: ACCOUNT.qty })
          : null,
    };
  });

  /* ── 7월 연쇄 — engine.replay() ─────────────────────────────── */
  function playJuly() {
    if (timer.current || !quantOk) return; // 불완전 카드면 replay가 throw / 신선하지 않으면 산출 안 함
    const result = replay(positions(PRICE_START), ledger(preset.card), JULY_SEQ, preset.card);
    setSteps(result);
    setCursor(0);
    setPlaying(true);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i >= result.length) {
        clearInterval(timer.current!);
        timer.current = null;
        setCursor(result.length - 1);
        setPlaying(false);
        return;
      }
      setCursor(i);
    }, 900);
  }

  /**
   * 다종목 — λ*·λ_k.
   *
   * ⚠ 이 줄의 주석은 원래 *"카드와 무관한 확정값이라 게이트를 걸지 않는다"* 였다.
   *   (다) 채택으로 **더는 카드와 무관하지 않다** — 원장 r 이 카드에서 나오므로 λ* 도
   *   카드가 바뀌면 바뀐다. 게이트를 안 거는 것은 그대로다(λ 는 h 유래 값이 아니다).
   *
   * ⚠ useMemo 를 걷어냈다. `[preset.card]` 로 고치자 React Compiler 가 거부했고
   *   (*"Existing memoization could not be preserved"*), 포지션 3개 계산이라 메모할
   *   이유가 없다. 컴파일러와 다투는 대신 지운다.
   */
  const pfView = portfolioLambdaView(PORTFOLIO_POSITIONS, portfolioLedger(preset.card));
  // pfView 가 매 렌더 새 객체라 `[pfView]` 메모는 의미가 없고, React Compiler 가
  // 그 의존성을 거부한다. 행 3개에서 최솟값을 고르는 것이라 그냥 계산한다.
  const pfWeakest = weakestRow(pfView);

  function playPortfolio() {
    if (pfTimer.current || !quantOk) return; // 처분 수량은 카드 h가 있어야 낸다
    const result = replayPortfolio(
      PORTFOLIO_POSITIONS,
      portfolioLedger(preset.card),
      portfolioJuly(),
      preset.card,
    );
    setPfSteps(result);
    setPfCursor(0);
    setPfPlaying(true);
    let i = 0;
    pfTimer.current = setInterval(() => {
      i += 1;
      if (i >= result.length) {
        clearInterval(pfTimer.current!);
        pfTimer.current = null;
        setPfCursor(result.length - 1);
        setPfPlaying(false);
        return;
      }
      setPfCursor(i);
    }, 900);
  }

  const cur = steps && cursor >= 0 ? steps[cursor] : null;
  const executedSteps = steps?.filter((s) => s.executedQty > 0) ?? [];

  /* ── 렌더 ──────────────────────────────────────────────────── */
  return (
    <div className="mg" data-state={breached ? "breach" : "safe"}>
      <div className="snapshot">
        📌 <b>스냅숏 모드</b> · KIS 미연동 · 가상 계좌(1,000주 · 융자 600만원 · 유지비율 140%) · 모든 수치는 결정론
        엔진 산출
      </div>

      <div className="wrap">
        <header className="hero">
          <div className="mark">
            마진가드 <small>MarginGuard — 반대매매 한계선 사전 진단</small>
          </div>
          <h1>주가를 이 선까지 끌어내려 보세요</h1>
          <p className="sub">
            문자가 오기 전에, 내 계좌의 한계선이 어디인지 — 약관이 정한 그대로 계산해 보여드립니다.
          </p>
        </header>

        <section className="sliderCard" aria-label="가격 시나리오 슬라이더">
          <div className="rail">
            <div
              id="priceBubble"
              className="tnum"
              style={{ left: `${((price - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100}%` }}
            >
              {won(price)}
            </div>
            <input
              type="range"
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={TICK}
              value={price}
              onChange={(e) => setPrice(roundTick(Number(e.target.value)))}
              aria-label="가격 시나리오"
            />
            <div className="railMeta">
              <span className="tnum">{won(PRICE_MIN)}</span>
              <span id="thresholdLabel" className="tnum">
                임계가 {policy.resolved ? won(pStar) : "—"}
              </span>
              <span className="tnum">{won(PRICE_MAX)}</span>
            </div>
          </div>

          <div className="headline">
            {/* ⚠ 카드가 r 을 못 정하면 **여기서부터 숫자가 없다.** 부족액도 임계가도
                r 에서 나오므로, 하나만 가리고 나머지를 내면 화면이 두 말을 한다 */}
            <div id="headline">
              {!policy.resolved
                ? "유지비율을 정하지 못했습니다"
                : breached
                  ? `담보부족 ${won(D)}`
                  : `임계가까지 여유 ${(((price - pStar) / price) * 100).toFixed(1)}%`}
            </div>
            <p id="subline">
              {!policy.resolved
                ? quantBlockReason
                : breached
                  ? "임계선을 지났습니다 — 아래는 약관 산정 방식의 재현값입니다"
                  : `${won(price - pStar)} 더 하락하면 담보부족 계산이 시작됩니다`}
            </p>
          </div>

          <div className="cards" role="group" aria-label="증권사 조건 카드">
            {cards.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`cardBtn${c.key === cardKey ? " active" : ""}`}
                onClick={() => {
                  setCardKey(c.key);
                  setSteps(null);
                  setCursor(-1);
                  if (timer.current) {
                    clearInterval(timer.current);
                    timer.current = null;
                  }
                  setPlaying(false);
                }}
              >
                {c.label} <span className="h">{c.hLabel}</span>
              </button>
            ))}
          </div>
          <p id="cardSource">{preset.source}</p>
          {fresh?.banner && <div id="cardBanner">{fresh.banner}</div>}
          {/* 신선도 배너와 **따로** 낸다 — 성질이 다르고 조치도 다르다(재검증 ↔ 값 대조).
              한 문장으로 합치면 사용자는 재검증만 하고 어긋남은 그대로 남는다.
              breached·asOf 어디에도 걸지 않는다: 관통 전에도 SSR 첫 페인트에도 뜬다 */}
          {ratio.banner && <div id="ratioBanner">{ratio.banner}</div>}
        </section>

        {/* 바로 위 #cardSource가 "심사필 제2026-0265호" 같은 출처 주장을 산문으로
            하고 있고, 사용자가 확인할 방법이 없었다. 그 문장 바로 아래에 좌표를 놓는다.
            결론 블록(#liqBox)에 붙이지 않은 이유: 기본 가격 10,000원 > 임계가 8,400원이라
            첫 페인트에서 breached=false이고 #liqBox는 DOM에 없다 — 슬라이더를 끌지 않은
            사람은 제품의 핵심 주장을 한 번도 보지 못한다 */}
        {/* ratio를 넘기는 이유: 이 패널이 카드의 유지비율을 근거 좌표·해시와 함께 크게
            찍는데, 바로 위 #headline의 부족액은 계좌 원장의 유지비율로 산출된다. 원장을
            안 넘기면 패널은 둘이 어긋난 것을 볼 수단이 없어 "근거 있는 170%"와
            "140%로 낸 부족액"을 모순 없어 보이게 나란히 낸다 */}
        <EvidencePanel view={evidence} fresh={fresh} ratio={ratio} />

        {/* 근거 패널 다음에 둔다 — 심사위원이 "우리 카드가 어디서 왔는지"를 먼저 보고
            나서 자기 약관을 올려 보는 순서다. 위에 두면 근거를 보기 전에 업로드부터
            누르게 되고, 그러면 이 제품의 주장(계산은 엔진이 하고 AI 는 인용만 한다)을
            보여줄 화면을 건너뛴다 */}
        <UploadPanel
          onCard={(next) => {
            setUploaded(next);
            setCardKey(next.key);
            // 재생 중이던 7월 연쇄를 멈춘다 — 카드가 바뀌면 그 재생은 다른 카드 것이다
            setSteps(null);
            setCursor(-1);
            if (timer.current) {
              clearInterval(timer.current);
              timer.current = null;
            }
            setPlaying(false);
          }}
        />

        <section className="grid" aria-label="계기판">
          <div className="panel">
            <div className="lbl">담보비율</div>
            <div className="val tnum">{shown === null ? "—" : `${shown}%`}</div>
            <div className="note">
              {shown === engineRatio
                ? "표시=내림 · 엔진 재현값 동일"
                : `표시=내림 · 엔진 재현값 ${engineRatio}%(사사오입) · 판정은 원시값`}
            </div>
          </div>
          <div className="panel">
            <div className="lbl">전 종목 균등 하락 여유 λ*</div>
            <div className="val tnum">
              {/* ⚠ NaN 도 받는다 — 카드가 r 을 못 정하면 λ* 가 NaN 이다 */}
              {!Number.isFinite(lambda)
                ? "—"
                : lambda === 0
                  ? "이미 관통"
                  : `−${(lambda * 100).toFixed(1)}%`}
            </div>
            <div className="note">전 종목이 함께 이만큼 빠지면 임계선</div>
          </div>
          <div className="panel">
            <div className="lbl">조건 카드</div>
            <div className="val" style={{ fontSize: 17 }}>
              {preset.card.status === "verified"
                ? `verified · ${preset.card.verified_at} 검증`
                : "draft · 미검수"}
            </div>
            <div className="note">신선도 게이트: 검증일 기준 30일</div>
          </div>
        </section>

        {breached && !quantOk && (
          <section id="liqBox" aria-label="반대매매 산정">
            <h2>이대로면 — 산정 불가</h2>
            <span className="mode full">{quantBlockReason}</span>
            {/* 유지비율이 어긋난 경우에는 "부족액은 확정입니다"라고 쓸 수 없다 — 그 문장은
                유지비율이 정해져 있다는 전제 위에 서 있고, 지금은 그 전제가 미정이다.
                대신 **어느 값으로 낸 숫자인지**를 밝힌다. 어느 쪽이 맞는지는 말하지 않는다 */}
            <div className="note">
              {ratio.confirmed ? (
                <>
                  담보부족액 {won(D)}은 확정입니다. 부족액은 유지비율만으로 정해지고, 처분 수량만 회사별
                  산정 기준가에 달려 있습니다. {hUnknown ? "카드를 검증해 채운 뒤" : "카드를 재검증한 뒤"} 다시 보세요.
                </>
              ) : (
                <>
                  담보부족액 {won(D)}은 {ratio.detail}
                </>
              )}
            </div>
          </section>
        )}

        {breached && quantOk && liq && paths && (
          <section id="liqBox" aria-label="반대매매 산정">
            <h2>이대로면 — 약관 산정 방식의 재현값</h2>
            <span id="liqQty" className="tnum">
              {liq.mode === "FULL" ? `전량 ${liq.qty.toLocaleString()}주` : `${liq.qty.toLocaleString()}주`}
            </span>
            <span className={`mode ${liq.mode === "FULL" ? "full" : "partial"}`}>
              {/* 전량은 세 갈래다 — k≤0 / 정확히 보유 전량 / 초과. 문구는 options.ts가 만든다 */}
              {forcedRow
                ? (fullDisposalLabel(forcedRow) ?? `부분 처분 (k=${liq.k.toFixed(2)})`)
                : `부분 처분 (k=${liq.k.toFixed(2)})`}
            </span>
            <div className="cmp" aria-label="회사별 비교">
              {compare.map((c) => (
                <span key={c.key}>
                  {c.label}{" "}
                  <b>
                    {c.unusable
                      ? "산정 불가"
                      : c.qty
                        ? c.qty.mode === "FULL"
                          ? "전량"
                          : `${c.qty.qty.toLocaleString()}주`
                        : "—"}
                  </b>
                </span>
              ))}
              <span style={{ borderStyle: "dashed" }}>같은 부족액, 회사만 다를 때</span>
            </div>
            {/* 빠진 행의 사유. 캡션은 "회사만 다르다"고 말하는데 실제로 빠진 이유가
                유지비율 충돌·h 부재·재검증이면 그것은 회사 차이가 아니다. 선택된
                카드가 멀쩡하면 이 사유가 화면 어디에도 남지 않으므로 여기 적는다 */}
            {compare.some((c) => c.unusable) && (
              <div className="cmpWhy">
                {compare
                  .filter((c) => c.unusable)
                  .map((c) => (
                    <p key={c.key}>
                      <b>{c.label}</b> {c.why}
                    </p>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* quantOk로 막지 않는다 — 4경로는 카드와 무관하고, 카드에 달린 것은
            강제 처분 대조뿐이다. 그 블록만 사유와 함께 내린다(#33 리뷰) */}
        {breached && optionRows && (
          <OptionsCompare
            options={optionRows}
            forced={quantOk ? forcedRow : null}
            verdict={quantOk ? verdict : null}
            forcedUnavailable={quantBlockReason}
            ratioUnconfirmed={!ratio.confirmed}
            shortfallAmount={D}
            cardStatus={preset.card.status}
          />
        )}

        {/* 다종목 — 단일 종목 화면이 답하지 못하는 질문. λ*·λ_k는 카드와 무관하므로
            blocked에서도 낸다. 재생(처분 수량)만 카드 h에 달려 있다 */}
        <PortfolioView
          view={pfView}
          weakest={pfWeakest}
          steps={pfSteps}
          cursor={pfCursor}
          playing={pfPlaying}
          onPlay={playPortfolio}
          disabledReason={quantBlockReason}
        />

        <section className="july">
          <h2>2026년 7월, 실제로 있었던 연쇄 하락을 재현해 보세요</h2>
          <span style={{ fontSize: 12.5, color: "var(--ink3)" }}>
            상관관계를 추정하지 않습니다 — 그날 실제로 움직인 값을 순서대로 적용하고, 집행이 일어나면 원장을 갱신해
            재관통까지 따라갑니다.
          </span>
          <br />
          <button
            id="julyBtn"
            type="button"
            onClick={playJuly}
            disabled={playing || !quantOk}
          >
            ▶ 7월 연쇄 재현 (7/7 → 7/29)
          </button>
          {!quantOk && (
            <span className="note">
              {!ratio.confirmed
                ? // 재현은 매일의 처분 수량을 원장에 되먹이므로 첫날 수량이 미정이면
                  // 그 뒤 20일이 전부 미정이다 — 한 줄도 내지 않는다
                  "유지비율이 하나로 확인되지 않아 재현하지 않습니다 — 처분 수량을 추정하지 않습니다"
                : hUnknown
                  ? "이 조건카드는 산정 기준가 규칙이 불완전해 재현할 수 없습니다 — 값을 추정하지 않습니다"
                  : "이 카드는 재검증이 필요해 재현하지 않습니다"}
            </span>
          )}

          {steps && (
            <div className="replay">
              <table className="replayTable">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>등락</th>
                    <th>종가</th>
                    <th>담보비율</th>
                    <th>부족액</th>
                    <th>상태</th>
                    <th>집행</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.slice(0, cursor + 1).map((s) => (
                    <tr key={s.date} className={`ph-${s.phase}`}>
                      <td>{s.date.slice(5)}</td>
                      <td className="tnum">{(s.dailyReturn / 100).toFixed(2)}%</td>
                      <td className="tnum">{s.pricePrev.toLocaleString()}</td>
                      <td className="tnum">
                        {s.ratioRaw === null ? "완제" : `${Math.floor(s.ratioRaw)}%`}
                      </td>
                      <td className="tnum">{s.shortfall > 0 ? won(s.shortfall) : "—"}</td>
                      <td>
                        <span className={`phase ${s.phase}`}>
                          {s.phase === "normal" ? "평상" : s.phase === "notified" ? "통지" : "집행"}
                        </span>
                      </td>
                      <td className="tnum">
                        {s.executedQty > 0
                          ? `${s.executedQty.toLocaleString()}주${
                              s.executedReason && s.executedReason !== "PARTIAL" ? " (전량)" : ""
                            }`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cur && cursor === steps.length - 1 && (
                <p className="replayNote">
                  {executedSteps.length > 0
                    ? `집행 ${executedSteps.length}회 — ${executedSteps
                        .map((s) => `${s.date.slice(5)} ${s.executedQty.toLocaleString()}주`)
                        .join(", ")}. ${
                        cur.shortfall > 0
                          ? `마지막 스텝에서 부족액 ${won(cur.shortfall)} 재발생 — 연쇄가 끝나지 않았습니다.`
                          : "연쇄 종료."
                      }`
                    : "이 시나리오에서는 집행이 발생하지 않았습니다."}
                </p>
              )}
            </div>
          )}
        </section>

        <footer>
          시연용 가상 계좌입니다. 본 화면의 수량·금액은 증권사 공개 설명서 산정 방식의 재현값이며{" "}
          <b>매도 권유가 아닙니다</b>. 회사 간 우열을 표시하지 않습니다. 조건 카드가 draft(검수 전)면 참고 모드로만
          동작합니다. · 담보비율은 판정=원시값 / 재현=사사오입 / 표시=내림 3단 규칙을 따릅니다.
          <span className="buildTag tnum">
            배포 <b>{build.shortSha}</b> · {build.branch}
          </span>
        </footer>
      </div>
    </div>
  );
}
