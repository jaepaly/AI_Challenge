"use client";

/**
 * 랜딩 — "주가를 이 선까지 끌어내려 보세요" (D)
 * ---------------------------------------------------------------------------
 * 원칙: 이 파일에 산식이 없다. 모든 수치는 @marginguard/engine이 낸다.
 *  - 임계가조차 직접 풀지 않고 engine.shortfall을 오라클로 이분 탐색한다.
 *  - 7월 연쇄는 engine.replay()가 낸 ReplayStep[]을 그대로 렌더한다(집행·원장 갱신 포함).
 *  - 담보비율 3단 규칙(PR #2 합의): 판정=원시값(engine) / 골든 재현=사사오입 / 표시=내림.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  equalShockLambda,
  liquidationQty,
  marginRatioPct,
  replay,
  resolutionPaths,
  shortfall,
  type ReplayStep,
} from "@marginguard/engine";
import { cardH } from "../lib/marginguard/card";
import { freshnessView, todayISO } from "../lib/marginguard/freshness-view";
import type { BuildInfo } from "../lib/build-info";
import {
  buildOptions,
  comparisonVerdict,
  forcedDisposal,
  fullDisposalLabel,
} from "../lib/marginguard/options";
import OptionsCompare from "./options-compare";
import {
  ACCOUNT,
  ASSUMED_FEE_RATE,
  CARDS,
  JULY_SEQ,
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

/** 임계가 = engine.shortfall이 0이 되는 최소 가격. 엔진을 오라클로 이분 탐색 */
function thresholdPrice(): number {
  let lo = Math.floor(PRICE_MIN / TICK);
  let hi = Math.floor(PRICE_MAX / TICK);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (shortfall(ACCOUNT.qty * mid * TICK, ACCOUNT.loan, ACCOUNT.requiredRatio) === 0) hi = mid;
    else lo = mid + 1;
  }
  return lo * TICK;
}

export default function Landing({ build }: { build: BuildInfo }) {
  const [price, setPrice] = useState(PRICE_START);
  const [cardKey, setCardKey] = useState(CARDS[0]!.key);
  const [steps, setSteps] = useState<ReplayStep[] | null>(null);
  const [cursor, setCursor] = useState(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 재생 중 여부는 state로 둔다 — ref를 렌더에서 읽으면 버튼 disabled가 갱신되지 않는다 */
  const [playing, setPlaying] = useState(false);

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

  const preset = CARDS.find((c) => c.key === cardKey)!;
  const h = cardH(preset.card);
  const hUnknown = h === null; // 조건카드 불완전 — 수량을 추정하지 않는다

  /** 신선도 게이트 — 판정은 엔진, 화면 규약은 lib/marginguard/freshness-view */
  const fresh = asOf ? freshnessView(preset.card, asOf) : null;
  /** 수량·배수를 낼 수 있는가. 카드가 불완전하거나 신선하지 않으면 내지 않는다 */
  const quantOk = !hUnknown && fresh?.quantitative !== false;
  const pStar = useMemo(() => thresholdPrice(), []);

  // 언마운트 시 재현 타이머 정리
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  /* ── 엔진 산출 ─────────────────────────────────────────────── */
  const V = ACCOUNT.qty * price;
  const D = shortfall(V, ACCOUNT.loan, ACCOUNT.requiredRatio);
  const breached = D > 0;

  const liq =
    breached && h !== null
      ? liquidationQty({ D, prevClose: price, r: ACCOUNT.requiredRatio, h, held: ACCOUNT.qty })
      : null;
  const paths = breached
    ? resolutionPaths({
        D,
        r: ACCOUNT.requiredRatio,
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

  const lambda = equalShockLambda(V, ACCOUNT.loan, ACCOUNT.requiredRatio, ACCOUNT.cash);

  const shown = displayRatio(V, ACCOUNT.loan); // 표시 = 내림
  const engineRatio = marginRatioPct(V, ACCOUNT.loan); // 골든 재현 = 사사오입

  // 회사별 비교도 카드마다 게이트를 건다 — 선택된 카드만 막고 비교 행에 수량을
  // 남기면, 같은 카드가 한 화면에서 "산정 불가"와 "전량"을 동시에 말하게 된다
  const compare = CARDS.map((c) => {
    const ch = cardH(c.card);
    const ok = ch !== null && (asOf === null || freshnessView(c.card, asOf).quantitative);
    return {
      key: c.key,
      label: c.label,
      unusable: !ok,
      qty:
        breached && ok
          ? liquidationQty({ D, prevClose: price, r: ACCOUNT.requiredRatio, h: ch, held: ACCOUNT.qty })
          : null,
    };
  });

  /* ── 7월 연쇄 — engine.replay() ─────────────────────────────── */
  function playJuly() {
    if (timer.current || !quantOk) return; // 불완전 카드면 replay가 throw / 신선하지 않으면 산출 안 함
    const result = replay(positions(PRICE_START), ledger(), JULY_SEQ, preset.card);
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
                임계가 {won(pStar)}
              </span>
              <span className="tnum">{won(PRICE_MAX)}</span>
            </div>
          </div>

          <div className="headline">
            <div id="headline">
              {breached ? `담보부족 ${won(D)}` : `임계가까지 여유 ${(((price - pStar) / price) * 100).toFixed(1)}%`}
            </div>
            <p id="subline">
              {breached
                ? "임계선을 지났습니다 — 아래는 약관 산정 방식의 재현값입니다"
                : `${won(price - pStar)} 더 하락하면 담보부족 계산이 시작됩니다`}
            </p>
          </div>

          <div className="cards" role="group" aria-label="증권사 조건 카드">
            {CARDS.map((c) => (
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
        </section>

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
              {lambda === 0 ? "이미 관통" : lambda === Infinity ? "—" : `−${(lambda * 100).toFixed(1)}%`}
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
            <span className="mode full">
              {hUnknown
                ? "조건카드에 산정 기준가 규칙(할인율)이 없습니다 — 처분 수량을 추정하지 않습니다"
                : "이 조건카드는 참고 모드입니다 — 처분 수량을 정식 산출로 내지 않습니다"}
            </span>
            <div className="note">
              담보부족액 {won(D)}은 확정입니다. 부족액은 유지비율만으로 정해지고, 처분 수량만 회사별
              산정 기준가에 달려 있습니다. {hUnknown ? "카드를 검증해 채운 뒤" : "카드를 재검증한 뒤"} 다시 보세요.
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
          </section>
        )}

        {breached && optionRows && forcedRow && verdict && (
          <OptionsCompare
            options={optionRows}
            forced={forcedRow}
            verdict={verdict}
            shortfallAmount={D}
            cardStatus={preset.card.status}
          />
        )}

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
              {hUnknown
                ? "이 조건카드는 산정 기준가 규칙이 불완전해 재현할 수 없습니다 — 값을 추정하지 않습니다"
                : "이 조건카드는 참고 모드라 재현하지 않습니다 — 재검증 후 다시 보세요"}
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
