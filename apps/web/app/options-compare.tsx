/**
 * 선택지 비교 화면 (D)
 * ---------------------------------------------------------------------------
 * 표현만 담당한다. 수치는 전부 engine → lib/marginguard/options 를 거쳐 들어온다.
 *
 * 화면이 지키는 것(HANDOFF §3 설계 결정):
 *  - **1차 출력은 금액.** 수량은 보조이고 "산정 방식 재현값" 라벨을 항상 붙인다
 *  - **추천하지 않는다.** 고정 순서로 나란히 놓기만 하고 순위·권장 표현을 쓰지 않는다
 *  - **근거 없는 값을 만들지 않는다.** 산정 불가는 빈칸이 아니라 사유를 적는다
 *  - 종목 선택 UI 없음 · 주문 경로 없음
 */
import type { OptionRow, ForcedRow } from "../lib/marginguard/options";

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export default function OptionsCompare({
  options,
  forced,
  ratio,
  shortfallAmount,
  cardStatus,
}: {
  options: OptionRow[];
  forced: ForcedRow;
  /** 강제 처분 ÷ 자발적 매도. 산정 불가면 null */
  ratio: number | null;
  shortfallAmount: number;
  /** draft면 이 섹션에도 참고 모드를 표시한다 — 배너가 화면 위쪽에만 있으면
   *  여기까지 스크롤한 사람은 미검수 카드인 줄 모른 채 숫자만 본다 */
  cardStatus: "verified" | "draft";
}) {
  return (
    <section className="opt" aria-label="담보부족 해소 선택지 비교">
      <h2>
        같은 부족액 {won(shortfallAmount)}, 해소 방법에 따라 규모가 다릅니다
        {cardStatus === "draft" && <span className="draftTag">참고 모드 · 미검수 카드</span>}
      </h2>
      <p className="optLead">
        아래는 <b>추천이 아니라 나란히 놓은 계산</b>입니다. 어느 쪽이 유리한지는 보유 현금·세금·잔여
        포지션에 따라 달라지므로 판단하지 않습니다.
      </p>

      <div className="optGrid">
        {options.map((o) => (
          <div key={o.key} className={`optCard${o.amount === null ? " na" : ""}`}>
            <div className="optLbl">{o.label}</div>
            {o.amount === null ? (
              <>
                <div className="optNa">산정 안 함</div>
                <div className="optWhy">{o.unavailable}</div>
              </>
            ) : (
              <>
                <div className="optAmt tnum">{won(o.amount)}</div>
                {o.qty !== null && (
                  <div className="optQty tnum">
                    {o.qty.toLocaleString()}주 <span className="repro">산정 방식 재현값</span>
                  </div>
                )}
                <div className="optBasis">{o.basis}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="optForced">
        <div className="optForcedHead">
          <span className="optLbl">아무것도 하지 않으면 — 강제 반대매매</span>
          <span className={`mode ${forced.mode === "FULL" ? "full" : "partial"}`}>
            {forced.mode === "FULL"
              ? forced.reason === "K_NON_POSITIVE"
                ? "전량 · k≤0로 부분 매도 복원 불가"
                : "전량 · 필요 수량이 보유 초과"
              : "부분 처분"}
          </span>
        </div>
        <div className="optForcedBody">
          <div className="optAmt tnum">{won(forced.amount)}</div>
          <div className="optQty tnum">
            {forced.qty.toLocaleString()}주 <span className="repro">산정 방식 재현값</span>
          </div>
          <div className="optBasis">
            할인된 산정 기준가로 수량을 정하기 때문에 같은 부족액에도 규모가 커집니다 · 평가액(전일종가)
            기준
          </div>
        </div>
      </div>

      {ratio !== null && (
        <p className="optPunch">
          미리 알고 자발적으로 매도할 때보다 <b>{ratio.toFixed(1)}배</b> 규모가 처분됩니다.
        </p>
      )}

      <p className="optFoot">
        네 경로 모두 <b>담보부족을 해소하는 방법</b>일 뿐 매도·매수 권유가 아닙니다. 실제 해소 인정
        시점과 절차는 회사마다 다릅니다 — 예컨대 D·D+1 일반매매로 해소 가능하다고 약관에 명시한 회사가
        있는 반면, 매매에 의한 상환은 전전일 신청·결제일 상환이라는 절차만 규정한 회사도 있습니다.
      </p>
    </section>
  );
}
