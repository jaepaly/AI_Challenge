/**
 * 다종목 화면 (D) — 한계선 3분해의 ①②
 * ---------------------------------------------------------------------------
 * 표현만 담당한다. 수치는 engine → lib/marginguard/portfolio 를 거쳐 들어온다.
 *
 * 단일 종목 화면이 답하지 못하는 질문에 답한다 — **"내 계좌엔 종목이 여러 개인데?"**
 *
 * 이 화면이 지키는 것:
 *  - **λ*를 먼저 읽게 한다.** λ_k는 "나머지가 그대로일 때"라는 반사실 가정 위의
 *    지표라, 먼저 보면 실제보다 안전하다고 읽힌다
 *  - **처분될 종목을 단정하지 않는다.** 엔진이 종목번호 순으로 배분하지만 한투 약관의
 *    보증금률·대출일 계층이 종목번호보다 상위이고 `Position`에 그 필드가 없다(#23).
 *    총 처분 규모는 순서와 무관하지만 **어느 종목이 팔리는지는 추정이다**
 *  - **재생은 역사 재현이 아니다.** 종목별 실데이터가 없어 균등 시나리오를 쓴다
 */
import type { PortfolioLambdaView, LambdaRow } from "../lib/marginguard/portfolio";
import type { PortfolioReplayStep } from "@marginguard/engine";

/**
 * 퍼센트 표시. **유한하지 않으면 "—" 다.**
 *
 * 카드가 유지비율을 하나로 못 정하면 원장 r 이 NaN 이고 λ*·λ_k 가 전부 NaN 이 된다
 * (#67 A-1). 그때 `toFixed(1)` 은 "NaN%" 를 찍는다 — 숫자처럼 생긴 것을 내면 안 된다.
 */
const pct = (n: number, digits = 1): string =>
  Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";

const won = (n: number) =>
  // ⚠ 유한하지 않으면 "NaN원"을 찍지 않는다. 카드가 유지비율을 못 정하면 파생값이
  //   전부 NaN 이 되는데, 그때 화면이 숫자처럼 생긴 것을 내면 안 된다(#67 A-1).
  Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "—";

export default function PortfolioView({
  view,
  weakest,
  steps,
  cursor,
  playing,
  onPlay,
  disabledReason,
}: {
  view: PortfolioLambdaView;
  weakest: LambdaRow | null;
  steps: PortfolioReplayStep[] | null;
  cursor: number;
  playing: boolean;
  onPlay: () => void;
  /** 재생 불가 사유. null이면 재생 가능 */
  disabledReason: string | null;
}) {
  const cur = steps && cursor >= 0 ? steps[cursor] : null;
  const executed = steps?.filter((s) => s.executedQtyTotal > 0) ?? [];
  /** 가장 취약한 종목이 먼저 팔린 종목과 같은가 — 우연히 같을 때만 그렇다고 말한다 */
  const firstSold = executed[0]?.positions.find((p) => p.executedQty > 0)?.symbol ?? null;
  const weakestIsFirstSold = weakest !== null && firstSold !== null && weakest.symbol === firstSold;

  return (
    <section className="pf" aria-label="다종목 한계선">
      <h2>종목이 여럿이면 — 한계선이 두 개가 됩니다</h2>
      <p className="optLead">
        같은 계좌인데 묻는 질문에 따라 답이 다릅니다. <b>함께 빠질 때</b>와{" "}
        <b>혼자 빠질 때</b>는 버티는 폭이 다릅니다.
      </p>

      <div className="pfStar">
        <div className="optLbl">전 종목이 동시에 하락할 때 — λ*</div>
        <div className="optAmt tnum">
          {view.breached ? "이미 관통" : pct(view.lambdaStarPct)}
        </div>
        <div className="optBasis">
          주식 평가액 {won(view.V)} · 버퍼 {won(view.buffer)} · 표시는 <b>내림</b>(여유를 올려 잡지
          않습니다)
        </div>
      </div>

      <div className="pfTableWrap">
        <table className="pfTable">
          <thead>
            <tr>
              <th>종목</th>
              <th className="num">보유</th>
              <th className="num">전일종가</th>
              <th className="num">평가액</th>
              <th className="num">비중</th>
              <th className="num">이 종목 혼자 — λ_k</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.symbol} className={weakest?.symbol === r.symbol ? "weak" : undefined}>
                <td>
                  {r.name} <span className="sym">{r.symbol}</span>
                </td>
                <td className="num tnum">{r.qty.toLocaleString()}주</td>
                <td className="num tnum">{won(r.prevClose)}</td>
                <td className="num tnum">{won(r.value)}</td>
                <td className="num tnum">{pct(r.weightPct)}</td>
                <td className="num tnum">
                  {r.lambdaKPct !== null ? (
                    pct(r.lambdaKPct)
                  ) : r.immune ? (
                    <span className="pfNa">0원이 돼도 관통 안 함</span>
                  ) : (
                    <span className="pfNa">산정 안 함 · 보유 없음</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {weakest && !view.breached && (
        <p className="optPunch">
          가장 먼저 걸리는 것은 <b>{weakest.name}</b>입니다 — 혼자 {pct(weakest.lambdaKPct!)}
          빠지면 관통합니다. 다만 <b>전 종목이 함께 {pct(view.lambdaStarPct)}</b>만 빠져도
          같은 일이 벌어집니다.
        </p>
      )}

      <div className="pfReplay">
        <h3>같은 충격이 며칠에 걸쳐 왔다면</h3>
        <button type="button" onClick={onPlay} disabled={playing || disabledReason !== null}>
          {playing ? "재생 중…" : "7월 일자로 재생"}
        </button>
        {disabledReason && <div className="optWhy">{disabledReason}</div>}

        {cur && (
          <div className="pfStep">
            <div className="pfStepHead">
              <b>{cur.date}</b>
              <span className={`phase ${cur.phase}`}>
                {cur.phase === "executed" ? "집행" : cur.phase === "notified" ? "통지" : "정상"}
              </span>
              <span className="tnum">
                포트폴리오 {pct(cur.portfolioReturn / 100, 2)}
              </span>
              <span className="tnum">
                담보비율 {cur.ratioRaw === null ? "—" : `${Math.floor(cur.ratioRaw)}%`}
              </span>
              <span className="tnum">부족액 {won(cur.shortfall)}</span>
            </div>
            {cur.executedQtyTotal > 0 && (
              <div className="pfExec">
                이 날 처분 <b className="tnum">{cur.executedQtyTotal.toLocaleString()}주</b>
                <span className="repro">산정 방식 재현값</span>
                <div className="pfExecBy tnum">
                  {cur.positions
                    .filter((p) => p.executedQty > 0)
                    .map((p) => `${p.symbol} ${p.executedQty.toLocaleString()}주`)
                    .join(" · ")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 집행은 시퀀스 중간에 일어나고 마지막 프레임은 보통 '통지'다. 현재 스텝만
            보여주면 배분이 지나가 버려 화면에 안 남는다 — 이 화면의 요점이 그 배분이다 */}
        {executed.length > 0 && (
          <div className="pfSummary">
            <div className="optLbl">이 시퀀스에서 집행된 날</div>
            {executed.map((s) => (
              <div key={s.date} className="pfSummaryRow tnum">
                <b>{s.date}</b> · {s.executedQtyTotal.toLocaleString()}주 ·{" "}
                {s.positions
                  .filter((p) => p.executedQty > 0)
                  .map((p) => `${p.symbol} ${p.executedQty.toLocaleString()}주`)
                  .join(" · ")}
              </div>
            ))}
            <div className="optBasis">
              앞 종목부터 채워지는 것은 <b>종목번호 오름차순</b> 배분이기 때문입니다 — 신용 채널
              약관 5사가 공통으로 명시한 최종 기준입니다.
            </div>
            {/* 위 표의 '가장 취약한 종목'과 여기 '먼저 팔린 종목'은 **기준이 다르다**.
                앞은 평가액이 커서, 뒤는 종목번호가 빨라서다. 한 화면에 붙어 있으면
                "취약해서 팔렸다"는 인과로 읽힌다 — 이 제품이 막으려는 종류의 오독이다.
                균등 시나리오라 더 위험하다: 종목별 하락폭 차이가 없으니 어느 종목이
                팔리는지를 정하는 것이 순서 하나뿐이다(#37 리뷰). */}
            <div className="optWhy">
              먼저 팔린 종목은 <b>종목번호가 빠른 종목</b>이지, 가장 취약한 종목이 아닙니다.
              {weakestIsFirstSold ? " 이 계좌에서는 둘이 우연히 같습니다." : ""}
            </div>
          </div>
        )}
      </div>

      <p className="optFoot">
        <b>어느 종목이 팔리는지는 추정입니다.</b> 엔진은 신용 채널 약관 5사가 공통으로 명시한 최종
        기준(종목번호 순)으로 배분하지만, 한투 약관은 보증금률·대출일 계층을 그보다 위에 둡니다 —
        우리 포지션 데이터에 그 필드가 없습니다. <b>총 처분 규모는 순서와 무관하게 같습니다.</b>
        <br />
        <b>이 재생은 역사 재현이 아니라 균등 시나리오입니다.</b> 날짜와 등락폭은 2026년 7월 실측이지만
        전 종목에 같은 값을 적용했습니다. 종목별 실제 등락은 서로 다르며, 종목별 실데이터 스냅숏은
        확보 예정입니다. <b>λ*·λ_k는 시나리오가 아니라 현재 계좌의 확정값입니다.</b>
      </p>
    </section>
  );
}
