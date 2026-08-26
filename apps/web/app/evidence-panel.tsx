/**
 * 약관 근거 표시 (D)
 * ---------------------------------------------------------------------------
 * 표현만 담당한다. 좌표·인용문·해시를 만들지 않고 lib/marginguard/evidence-view가
 * 좁혀준 뷰모델을 그린다. 이 파일에 판정도 산식도 없다.
 *
 * 화면이 지키는 것:
 *
 *  - **제목이 출처를 단언하지 않는다.** 값과 인용문을 한 행에 나란히 놓는 것만으로도
 *    사람은 "이 값은 이 문장에서 나왔다"로 읽는다. 그런데 화면이 실제로 보증할 수
 *    있는 것은 "이 인용문이 원문 그 좌표에 있다"까지다(evidence-view.ts 머리글).
 *    그래서 제목은 조항과 원문을 잇는 데까지만 말하고, 수치와 문장의 관계는
 *    **행 단위로** 말한다.
 *
 *  - **인용문이 옆 수치 말고 다른 값도 담고 있으면 그 사실을 접힌 상태에서 적는다.**
 *    "표기가 인용문에 있다"만 보면 이 경우가 통째로 침묵 구간이 된다 — 값 하나를 크게
 *    찍어 놓고 옆 인용문에 다른 값이 섞여 있는데 화면이 아무 말도 안 하면, 사용자는
 *    인용문 전체가 그 하나를 뒷받침한다고 읽는다. 실측 3행이 그렇다(한투 execution의
 *    대주 120%·대주전용 105%, 메리츠 ratio의 C∙D군 150%, 메리츠 execution이 인용하지
 *    않은 120%·105% 구간). ⚠ 이것도 **부정 방향**이다 — "옆 수치가 틀렸다"가 아니라
 *    "인용문에 다른 표기도 있다"는 사실 진술이고, 어느 부분이 근거인지는 판정하지 않는다.
 *
 *  - **표기가 인용문에 없는 행은 그 사실을 접힌 상태에서도 적는다.** 2026-08-18 전에는
 *    스냅숏 execution 3장이 그 경우였다 — 인용문은 집행 일정을 서술하는데 옆에는
 *    threshold_ratio 140%가 붙고, 저장소 자신의 대조기(schemas.py의
 *    require_threshold_ratio_in_quote)에 넣으면 셋 다 거부됐다. 좌표를 조항으로
 *    교체해 지금은 9개 스팬 전부 표기를 담고 있고, 그래서 이 문구가 화면에 하나도
 *    뜨지 않는다. **그렇다고 이 경로를 지우면 안 된다** — 인제스트가 만드는 카드에는
 *    그 보증이 지금도 없고, 지우는 순간 다음에 같은 짝이 오면 화면이 침묵한다.
 *    ⚠ 반대 방향(표기가 있는 행에 "확인됨" 배지)은 만들지 않는다 — 비대칭이 규약이다.
 *
 *  - **좌표가 정본이다.** 인용문만 보여주고 좌표를 숨기지 않는다 — 메리츠 disposal
 *    인용문은 원문에 같은 문장이 두 번 나와서('가. 담보부족계좌의 임의상환' @14999와
 *    '나. 신용융자금 미상환시 임의상환' @15111), 인용문만으로는 어느 조항인지 특정되지
 *    않는다. 그래서 좌표는 **접힌 상태에서도** 보인다.
 *
 *  - **접힌 상태가 펼친 내용보다 단정적이면 안 된다.** 좌표 폭이 인용문 길이와
 *    어긋나 그 좌표가 그 인용문을 설명하지 못하는 행은, 펼치기 전에도 그렇게 보여야
 *    한다. 경고를 본문에만 두면 "펼친 사람만 진실을 보는" 화면이 된다.
 *
 *  - **인용문을 자르지 않는다.** 접기는 CSS(<details>)로 한다 — 접혀 있어도 전문이
 *    DOM에 그대로 있고, 검색·복사·스크린리더에 걸린다. 요약줄의 한 줄 미리보기는
 *    공백을 접어 만든 것이라 원문이 아니고, 그 사실을 라벨로 밝힌다.
 *
 *  - **day_counting에는 좌표도 근거 표시도 붙이지 않는다.** 이유는 evidence-view.ts의
 *    DAY_COUNTING_WHY에 있다. 이 컴포넌트는 `rows`와 `unbacked`를 **다른 코드 경로로**
 *    그린다 — 좌표 pill·인용 상자를 그리는 JSX가 unbacked에는 아예 닿지 않는다.
 *    "일관성"을 이유로 아래 unbacked 블록에 배지를 옮겨 붙이지 말 것.
 *
 *  - **신선도로 가리지 않는다.** blocked 카드에서도 그대로 보여준다. 게이트 원칙이
 *    "카드에서 오는 파라미터는 h뿐이고 h 유래 값만 내린다"이고(freshness-view.ts:55-59),
 *    근거는 h 유래 파생값이 아니라 문서 사실이다. 오히려 blocked는 사람이 "왜 계산을
 *    못 하나"를 묻는 화면이라, 재검증하러 가려면 어느 판본의 어느 문장인지가 있어야 한다.
 *    **대신 만료 사실을 이 섹션에도 적는다** — 가리지 않는 것과 만료를 숨기는 것은 다르다.
 *    "이 카드는 못 쓴다"는 배너 바로 아래에서 근거 머리글이 검수 표시를 자격 없이 내면
 *    사용자는 그것을 "그래도 이 인용은 검증된 것"으로 읽는다.
 *
 *  - **화면의 계산이 옆 값과 다른 유지비율을 썼으면 그 사실을 그 행에 적는다.**
 *    이 패널은 카드의 `ratio`를 근거 좌표·해시와 함께 크게 찍는데, 담보부족액은
 *    계좌 원장의 유지비율로 산출된다. 둘이 어긋나면 "근거 있는 170%"와 "140%로 낸
 *    부족액"이 한 스크롤 안에 **모순 없어 보이게** 놓인다. 기존 두 경고 경로는 이걸
 *    못 잡는다 — figureInQuote·otherFigures는 **인용문 vs 카드값**만 보고 원장을
 *    보지 않는다. 오히려 인제스트가 조항을 정확히 뽑을수록(인용문에 "170%"가 글자로
 *    있을수록) 둘 다 침묵한다. 그래서 원장 값을 새 입력으로 받아 적는다.
 *    ⚠ 이것도 **부정 방향**이다 — "카드가 틀렸다"도 "원장이 틀렸다"도 아니고
 *      "화면에 나란히 놓인 두 숫자가 같지 않다"는 사실 진술이다. 일치하면 아무 말도
 *      하지 않는다(통과에 "확인됨" 배지를 만들지 않는다 — 비대칭이 규약이다).
 */
import type { FreshnessView } from "../lib/marginguard/freshness-view";
import type { RatioView } from "../lib/marginguard/ratio-view";
import type { EvidenceRow, EvidenceView } from "../lib/marginguard/evidence-view";

function Quote({ row }: { row: EvidenceRow }) {
  return (
    <details className="evQuote">
      <summary className="evQuoteSum">
        <span className="evMark" aria-hidden="true" />
        <span className="evPreview">{row.preview}</span>
        {/* 접힌 줄은 공백을 접은 표시물이다. 90자를 넘으면 …가 축약을 알리지만
            90자 미만이면서 개행·탭만 접힌 인용문은 …도 없고, 공백 치환은 길이를
            바꾸지 않아 옆의 자수까지 원문과 같다 — 라벨이 없으면 원문으로 읽힌다 */}
        {row.previewFolded && <span className="evFold">미리보기</span>}
        <span className="evMeta tnum">
          <span className={row.widthMismatch ? "evLoc bad" : "evLoc"}>{row.locator.label}</span> ·{" "}
          {row.sourceFormatLabel} · {row.quoteLength.toLocaleString("ko-KR")}자
          {/* 좌표가 인용문을 설명하지 못하는 행은 **접힌 상태에서도** 정상 행과 달라야
              한다. 본문에만 두면 펼치지 않은 사람은 확정적인 좌표 pill만 본다 */}
          {row.widthMismatch && <span className="evLocWarn"> · ⚠ 좌표 폭 불일치</span>}
        </span>
      </summary>

      {/* 원문 그대로. max-height + 내부 스크롤이라 1,621자가 들어와도 아래 블록을
          밀어내지 않는다. 잘라내지 않으므로 전문이 항상 여기 있다 */}
      <p className="evFull">{row.quote}</p>

      {row.previewFolded && (
        <p className="evHash">
          위 요약줄은 줄바꿈·탭을 공백으로 접고 90자에서 줄인 미리보기입니다 — 원문은 바로
          위 상자에 그대로 있습니다.
        </p>
      )}

      {row.locator.kind === "char" ? (
        <p className="evHash">
          평탄화 sha256{" "}
          <code className="evMono" title={row.locator.flattenedSha256}>
            {row.locator.shaShort}
          </code>{" "}
          · 좌표 {row.locator.label} ({row.locator.width.toLocaleString("ko-KR")}자)
          <br />이 해시는 <b>좌표가 가리키는 평탄화 결과물</b>의 것입니다 — 문서 판본
          식별자와는 다른 값입니다. 형식 표기도 원본 파일 형식이 아니라 그 평탄화
          결과물의 형식입니다 — 원본이 PDF여도 텍스트로 평탄화해 인용했으면 평탄화
          텍스트로 적힙니다.
        </p>
      ) : (
        <p className="evHash">
          페이지 좌표에는 평탄화 해시가 없습니다 — 원본 PDF의 쪽 번호가 정본입니다.
        </p>
      )}

      {row.locator.kind === "char" && row.widthMismatch && (
        <p className="evWarn">
          ⚠ 좌표 폭 {row.locator.width.toLocaleString("ko-KR")}자와 인용문 길이{" "}
          {row.quoteLength.toLocaleString("ko-KR")}자가 다릅니다 — 이 좌표는 이 인용문을
          설명하지 못합니다.
        </p>
      )}
    </details>
  );
}

/**
 * 신선도 만료를 근거 머리글에 적는 문장. 근거를 **가리지 않고** 자격만 붙인다.
 *
 * blocked에서만 낸다 — draft(reference)는 머리글의 "카드 검수 전(draft)"이 이미 같은
 * 말을 하고, 한 번도 정식인 적 없는 값에 "만료"를 말하는 것은 틀린 문장이다.
 */
function staleNote(fresh: FreshnessView): string | null {
  if (fresh.mode !== "blocked") return null;
  const head =
    fresh.verdict.reason === "STALE" && fresh.verdict.ageDays !== null
      ? `검증일로부터 ${fresh.verdict.ageDays.toLocaleString("ko-KR")}일 경과(허용 30일) — 위 검수 표시는 만료됐습니다.`
      : "이 카드에는 검증일이 없어 위 검수 표시가 언제 것인지 확인되지 않습니다.";
  return `⚠ ${head} 인용문과 좌표는 문서 사실이라 그대로 두지만, 카드는 재검증이 필요합니다.`;
}

export default function EvidencePanel({
  view,
  fresh = null,
  ratio = null,
}: {
  view: EvidenceView;
  /** 신선도 판정. 없으면(SSR 등) 자격 문장을 지어내지 않고 아무것도 적지 않는다 */
  fresh?: FreshnessView | null;
  /**
   * 카드 r ↔ 원장 r 대조. 없으면 아무것도 적지 않는다 — 원장을 못 받은 화면이
   * "맞다"고도 "다르다"고도 말할 수 없다. 신선도와 달리 시계에 묶이지 않으므로
   * SSR 첫 페인트에서도 넘어온다.
   */
  ratio?: RatioView | null;
}) {
  const stale = fresh === null ? null : staleNote(fresh);
  /** 일치하면 null — 통과에 배지를 만들지 않는다 */
  const ratioNote = ratio === null || ratio.confirmed ? null : ratio.evidenceNote;
  /**
   * 유지비율 행이 있으면 그 행에 붙인다(큰 숫자 바로 아래). 행이 없는 카드
   * (ratio_rules가 빈 경우)에서도 침묵하면 안 되므로 그때는 머리글 아래로 올린다.
   */
  const hasRatioRow = view.rows.some((r) => r.role === "ratio");

  return (
    // id 는 E2E 가 이 패널 안으로 범위를 좁히는 데 쓴다. 클래스명으로 잡으면
    // 나중에 스타일을 만질 때 검사가 조용히 다른 것을 보게 된다 — 실제로 `#75` 에서
    // `getByText("140%").first()` 가 근거 패널이 아니라 상단 스냅숏 고지문을 잡고 있었다.
    <section id="evidencePanel" className="ev" aria-label="약관 근거">
      {/* 제목이 "이 수치가 나온 문장"이면 행마다 출처를 단언하는 것이 된다. 화면이
          보증할 수 있는 것은 "이 인용문이 원문 그 좌표에 있다"까지이고, 그 문장이 옆
          수치를 뒷받침하는지는 어느 행에서도 판정하지 않는다 — 표기가 인용문에 글자로
          들어 있어도 마찬가지다. 그래서 제목은 조항↔원문까지만 말하고, 수치와 문장의
          관계는 행 단위로 적는다 */}
      <h2>조항별 약관 원문과 좌표</h2>
      <p className="evLead">
        좌표는 <b>인용문이 원문 평탄화 결과의 그 위치에 글자 그대로 있다</b>는 것까지를
        말합니다. 옆의 수치가 그 문장에서 도출된다는 자동 대조는 여기 포함되지 않습니다.
        다만 수치 표기가 인용문에 글자로 없는 행에는 그 사실을 적습니다 — 표기가 있는
        행이라고 해서 그 수치가 확인됐다는 뜻은 아닙니다.
      </p>

      <div className="evDoc">
        <b>{view.broker}</b>
        <span>
          {view.doc.label}
          {view.doc.kind !== "none" && (
            <>
              {" "}
              <span className="evMono" title={view.doc.value}>
                {view.doc.short}
              </span>
            </>
          )}
        </span>
        <span>{view.verifiedAt === null ? "검증일 없음" : `검증일 ${view.verifiedAt} 판본 기준`}</span>
        {/* 원시 토큰 "verified"를 그대로 찍지 않는다 — 근거 섹션 문맥에서는
            "이 인용·좌표가 검증됨"으로 읽힌다. 이 저장소에서 그 말이 뜻하는 것은
            사람이 카드를 검수했다는 것뿐이다(evidence-view.ts 머리글 ⚠) */}
        <span>{view.statusLabel}</span>
      </div>

      {stale !== null && <p className="evStale">{stale}</p>}

      {/* 유지비율 행이 없는 카드에서도 침묵하지 않는다 — 행에 붙일 자리가 없을 뿐,
          "화면의 부족액은 원장 값으로 냈고 카드에는 맞춰 볼 조항이 없다"는 사실은
          여전히 사용자가 알아야 한다 */}
      {ratioNote !== null && !hasRatioRow && <p className="evRatioGap">⚠ {ratioNote}</p>}

      {view.empty !== null && <p className="evEmpty">{view.empty}</p>}

      {view.rows.map((row) => (
        // `data-role` 은 E2E 가 **유지비율 행 하나**로 범위를 좁히는 데 쓴다. 클래스명이나
        // 문구로 잡으면 스타일·문구를 만질 때 검사가 조용히 다른 행을 보게 된다 —
        // 이 파일 아래쪽 주석이 `#75` 에서 실제로 겪은 그 사고를 적어 두었다.
        <div className="evRow" data-role={row.role} key={row.role}>
          <div className="evRowHead">
            <span className="evTitle">{row.title}</span>
            <span className="evField">{row.field}</span>
            <b className="evVal tnum">{row.value}</b>
            {row.figureInQuote === false && (
              <span className="evNoFigure">인용문에 이 표기 없음</span>
            )}
          </div>

          {/* 접기 **밖**이고, 이 행의 다른 문단들보다 **먼저** 온다.
              ① 이 행의 큰 숫자를 화면의 부족액이 쓰지 않았다는 것은 옆 인용문 이야기보다
                 앞선 사실이다 — 뒤에 두면 사용자는 "출처는 확인됐고 세부만 남았다"로 읽는다.
              ② 아래 otherFigures 문단이 "카드가 값으로 두는 것은 옆의 하나뿐"이라고 단언하는데,
                 어긋난 상태에서 화면의 부족액을 만든 값은 그 하나가 아니다. 두 문장이 정면으로
                 부딪히지 않게 **계산이 쓴 값을 먼저** 밝힌다. */}
          {ratioNote !== null && row.role === "ratio" && (
            <p className="evRatioGap">⚠ {ratioNote}</p>
          )}

          {/* 접기 **밖**이다 — 펼치지 않아도 보여야 한다. 값과 인용문이 한 행에 있는
              것 자체가 출처 주장으로 읽히므로, 그 주장이 성립하지 않는 행은 접힌
              상태에서 이미 달라야 한다 */}
          {row.figureInQuote === false && (
            <p className="evNoFigureWhy">
              아래 인용문에는 <b>{row.figure}</b>가 글자로 나오지 않습니다. 옆 수치는 카드에
              적힌 값이고, 이 문장이 그 수치를 뒷받침하는지는 화면이 판정하지 않습니다.
            </p>
          )}

          {/* 접기 **밖**이다. 요약줄(.evPreview)은 nowrap + ellipsis라 본문 폭에서
              잘리므로, 인용문 뒤쪽에 있는 사실은 접힌 화면에 아예 도달하지 못한다 —
              한투 execution 192자가 그 경우다(앞 90자에 대주 120%·대주전용 105%만 보이고
              집행 시점 행은 코드포인트 164 뒤에 있다). 잘리지 않는 문단으로 낸다.
              값이 틀렸다는 판정이 아니라 "인용문에 다른 값도 함께 있다"는 사실 진술이다 */}
          {row.otherFigures.length > 0 && (
            <p className="evOtherFig">
              아래 인용문에는 옆 수치 <b>{row.figure}</b> 말고{" "}
              <b>{row.otherFigures.join(", ")}</b>도 함께 들어 있습니다 — 인용 구간이 표의
              여러 행이나 여러 구간에 걸쳐 있기 때문입니다. 카드가 값으로 두는 것은 옆의
              하나뿐이고, 인용문의 어느 부분이 그 값의 근거인지는 화면이 판정하지 않습니다.
            </p>
          )}

          {row.overlapsSpanOf !== null && (
            <p className="evOverlap">
              이 근거 구간은 <b>{row.overlapsSpanOf.title}</b>의 근거 구간과{" "}
              {row.overlapsSpanOf.label}에서 겹칩니다 — 두 행의 근거가 서로 독립적이지
              않습니다.
            </p>
          )}

          {row.sameSpanAs === null ? (
            <Quote row={row} />
          ) : (
            /* 같은 스팬을 두 번 그리지 않는다 — 2,462자짜리 표 덤프가 두 벌 쌓이면
               그 아래 블록이 전부 화면 밖으로 밀린다. 좌표는 그대로 남긴다 */
            <p className="evSame">
              근거가 <b>{row.sameSpanAs}</b>과 같은 문장입니다 — 좌표 {row.locator.label}. 같은
              인용문을 두 번 싣지 않습니다.
            </p>
          )}
        </div>
      ))}

      {/* ── 인용문도 좌표도 붙지 않는 필드 ──────────────────────────────────
          위 rows와 **다른 코드 경로**다. 좌표 pill(.evLoc)도 인용 상자(.evFull)도
          해시(.evHash)도 여기 없다. 왜 다른지를 값 옆에 문장으로 남긴다 —
          라벨 없이 값만 놓으면 사용자는 위 인용문이 이것도 뒷받침한다고 읽는다.

          배지 문구에 "대조"를 쓰지 않는다. 리드 문단이 "자동 대조는 어느 행에도 없다"고
          말하는데 여기서만 "대조 없음"이라고 하면 두 문장이 모순되고, 모순은 과대주장
          쪽으로 해소된다 — 위 행들이 대조를 받은 것으로 읽힌다. 실제로 이 필드에만
          없는 것은 **붙은 좌표**이므로 그렇게 적는다 */}
      {view.unbacked.map((u) => (
        <div className="evUnbacked" key={u.field}>
          <div className="evUnbackedHead">
            <span className="evTitle">{u.field}</span>
            <b className="evVal">{u.value}</b>
            <span className="evNoEv">근거 좌표 없음</span>
          </div>
          <p className="evUnbackedWhy">{u.why}</p>
        </div>
      ))}
    </section>
  );
}
