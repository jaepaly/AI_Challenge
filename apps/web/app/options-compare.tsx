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
 *
 * **4경로와 강제 처분 대조는 의존이 다르다**(#33 리뷰에서 드러난 불일치).
 *  - 4경로 = 원장 r · 가격 · 제비용 f. **조건카드와 무관하다** — engine.resolutionPaths가
 *    h를 아예 받지 않는 것이 근거다
 *  - 강제 처분·배수 = 카드의 h 유래. 카드가 blocked(STALE·검증일 없음)면 낼 수 없다
 *
 * 그래서 `forced`/`verdict`는 **null이 될 수 있다.** 이전에는 이 컴포넌트를 통째로
 * 가려서, 엔진은 "4경로는 blocked에서도 살린다"인데 화면은 "다 가린다"였다.
 * 카드와 무관한 사실까지 같이 사라지는 것은 과잉 차단이다.
 */
import type { OptionRow, ForcedRow, ComparisonVerdict } from "../lib/marginguard/options";
import { fullDisposalKind, fullDisposalLabel } from "../lib/marginguard/options";

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export default function OptionsCompare({
  options,
  forced,
  verdict,
  forcedUnavailable,
  ratioUnconfirmed = false,
  shortfallAmount,
  cardStatus,
}: {
  options: OptionRow[];
  /** 카드 h가 없거나 blocked면 null — 4경로는 그대로 두고 이 블록만 내린다 */
  forced: ForcedRow | null;
  /** 결론 한 줄. 배수가 성립하는 경우와 아닌 경우가 나뉜다 — options.ts 참조 */
  verdict: ComparisonVerdict | null;
  /** forced가 null인 사유. 빈칸으로 두지 않고 이 문장을 그대로 보여준다 */
  forcedUnavailable?: string | null;
  /**
   * 카드 r과 원장 r을 하나로 맞추지 못했는가.
   *
   * 아래 "위 해소 경로는 그대로입니다" 문장을 갈아 끼우기 위한 것이다. 그 문장은
   * 4경로가 **담보유지비율과 가격만으로** 정해진다는 것을 안심의 근거로 삼는데,
   * 바로 위 사유 줄이 "그 유지비율이 하나로 확인되지 않았다"고 말하는 상황에서는
   * 두 문장이 같은 상자 안에서 정면으로 부딪힌다. 4경로를 내리지는 않는다
   * (내리면 화면 정지가 된다) — 대신 **어느 값으로 낸 것인지**를 밝힌다.
   */
  ratioUnconfirmed?: boolean;
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

      {forced === null ? (
        <div className="optForced na">
          <div className="optForcedHead">
            <span className="optLbl">아무것도 하지 않으면 — 강제 반대매매</span>
          </div>
          <div className="optNa">산정 안 함</div>
          <div className="optWhy">{forcedUnavailable}</div>
          <div className="optBasis">
            {ratioUnconfirmed ? (
              <>
                위 해소 경로는 그대로 둡니다 — <b>계좌 원장의 담보유지비율과 가격으로 산출했고
                조건카드를 쓰지 않습니다.</b> 다만 그 유지비율이 카드의 값과 같은지는 확인되지
                않았습니다 — 위 금액은 원장 기준입니다.
              </>
            ) : (
              <>
                위 해소 경로는 그대로입니다 — <b>담보유지비율과 가격만으로 정해지고 조건카드를 쓰지
                않습니다.</b> 회사별 산정 기준가에 달린 것은 강제 처분 수량뿐입니다.
              </>
            )}
          </div>
        </div>
      ) : (
      <div className="optForced">
        <div className="optForcedHead">
          <span className="optLbl">아무것도 하지 않으면 — 강제 반대매매</span>
          <span className={`mode ${forced.mode === "FULL" ? "full" : "partial"}`}>
            {forced.mode === "FULL"
              ? forced.reason === "K_NON_POSITIVE"
                ? "전량 · k≤0로 부분 매도 복원 불가"
                : (fullDisposalLabel(forced)?.replace("전량 — ", "전량 · ") ?? "전량")
              : "부분 처분"}
          </span>
        </div>
        <div className="optForcedBody">
          <div className="optAmt tnum">{won(forced.amount)}</div>
          <div className="optQty tnum">
            {forced.qty.toLocaleString()}주 <span className="repro">산정 방식 재현값</span>
            {forced.mode === "FULL" && forced.rawQty !== null && (
              <>
                {" "}
                · 필요 수량 {forced.rawQty.toLocaleString()}주
                {fullDisposalKind(forced) === "exceeded"
                  ? " — 보유 전량으로도 모자랍니다"
                  : " — 보유 전량과 정확히 같습니다"}
              </>
            )}
          </div>
          <div className="optBasis">
            할인된 산정 기준가로 수량을 정하기 때문에 같은 부족액에도 규모가 커집니다 · 평가액(전일종가)
            기준
          </div>
        </div>
      </div>
      )}

      {verdict?.kind === "ratio" && (
        <p className="optPunch">
          미리 알고 자발적으로 매도할 때보다 <b>{verdict.ratio.toFixed(1)}배</b> 규모가 처분됩니다.
        </p>
      )}
      {verdict?.kind === "forced_capped" && (
        <p className="optPunch">
          지금 스스로 팔면 <b>{verdict.voluntaryQty.toLocaleString()}주</b>로 끝납니다. 강제 반대매매는
          보유 {verdict.held.toLocaleString()}주를 <b>전량</b> 처분하고도 부족액이 남습니다.
        </p>
      )}
      {verdict?.kind === "unresolvable" && (
        <p className="optPunch">
          이 가격에서는 <b>전량을 팔아도 해소되지 않습니다</b> — 남는 것은 잔여채무입니다. 입금·상환만이
          경로입니다.
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
