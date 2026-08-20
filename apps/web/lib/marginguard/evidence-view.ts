/**
 * 약관 근거 좌표 → 화면 뷰모델 (D)
 * ---------------------------------------------------------------------------
 * 이 파일은 **판정하지 않는다.** 조건카드에 이미 박혀 있는 EvidenceSpan을 화면이
 * 그릴 수 있는 모양으로 좁히고 라벨을 붙일 뿐이다. 좌표·인용문·해시를 만들거나
 * 고치지 않는다 — 만드는 곳은 services/ingest이고, 스냅숏 카드의 좌표는
 * services/ingest/tests/test_snapshot_evidence.py가 CI에서 원문과 대조한다.
 *
 * **화면이 주장할 수 있는 것의 상한** — 넘기면 이 제품이 파는 문장이 거짓이 된다.
 *
 *  ✔ 보증됨 — `flattened[char_start:char_end]`가 인용문과 글자 단위로 같고,
 *    `flattened_sha256`이 그 평탄화 결과물의 해시다. 스냅숏 9개 스팬 전부가
 *    CI 검사 대상이다(test_snapshot_evidence.py).
 *
 *  ✘ 보증 안 됨 — "옆의 수치가 그 인용문에서 도출된다"는 자동 대조. Pydantic이
 *    ratio·discount_rate·threshold_ratio를 인용문과 대조하기는 하지만 **그 결과가
 *    카드에 기록되지 않아 화면이 읽을 방법이 없다.** 즉 "스키마에 validator가 있다"를
 *    근거로 배지를 만들면 화면은 자기가 확인하지 않은 것을 확인했다고 말하게 된다.
 *    그래서 **수치 단위 "대조됨" 배지를 만들지 않는다.** 좌표 표시가 말하는 것은
 *    인용문의 위치까지이고, 화면 문구도 딱 거기까지만 말한다.
 *
 *    ⚠ 그리고 그 대조는 **글자 대조일 뿐이다.** 2026-08-18까지 스냅숏 9개 중 5개가
 *    '이해를 돕기 위해 작성한 예시' 블록 안의 문장이었는데, 그중 셋은 Pydantic을
 *    통과했다 — 인용문에 "140%"라는 글자가 있으면 그것이 조항 값인지 예시 계좌의
 *    가정치인지는 묻지 않기 때문이다. 검증기 통과는 규범성의 보증이 아니다.
 *    (좌표는 조항으로 교체했다. 규범성 검사는 CI에 있다 —
 *     services/ingest/tests/test_snapshot_evidence_normativity.py)
 *
 *  ⚠ 단, **부정은 말한다**(figureInQuote). 화면은 값과 인용문을 한 행에 나란히
 *    놓으므로, 아무 말도 안 하면 사람은 그 짝을 출처 관계로 읽는다. 그래서
 *    **표기가 인용문에 글자로 없는 행에만** 그 사실을 적는다.
 *
 *    2026-08-18 기준 스냅숏 9개 스팬은 전부 표기를 담고 있어 이 문구가 하나도 뜨지
 *    않는다. 그렇다고 이 경로를 지우면 안 된다 — 교체 전에는 execution 3장이 전부
 *    여기 걸렸고(인용문은 집행 일정만 서술하는데 옆에는 threshold_ratio 140%가
 *    붙었다), 인제스트가 만드는 카드에는 그 보증이 지금도 없다.
 *    이 비대칭이 규약이다:
 *      · "없다"는 화면에 나란히 놓인 두 문자열에 대한 진술이라 사용자가 눈으로
 *        검증할 수 있다. 새 보증을 만들지 않는다.
 *      · "있다"는 아무것도 뜻하지 않으므로(글자가 겹칠 뿐) 표시하지 않는다.
 *    검사가 느슨해서 "없는데 없다고 안 하는" 쪽으로 틀리면 화면은 그냥 침묵한다 —
 *    과대주장이 되지 않는 방향이다. 반대로 엄격하게 만들어 있는 것을 없다고 하면
 *    거짓 경고가 되므로, 애매하면 느슨한 쪽으로 둔다.
 *
 *  ⚠ figureInQuote만으로는 **부족하다**(otherFigures). "옆 수치가 인용문에 있다"가
 *    true여도 그 인용문이 **다른 값도 함께** 담고 있으면 화면은 완전히 침묵한다.
 *    실측 스냅숏에서 세 행이 그렇다 — 한투 execution(140% 옆에 대주 120%·대주전용
 *    105%), 메리츠 ratio(A∙B군 140% 옆에 C∙D군 150%), 메리츠 execution(140%~150%
 *    구간만 규정하고 같은 표의 120%·105% 구간은 인용 밖). 값 하나를 크게 찍어 놓고
 *    그 옆 인용문에 다른 값이 섞여 있는데 아무 말도 없으면, 사용자는 인용문 전체가
 *    그 하나의 값을 뒷받침한다고 읽는다. 그래서 **다른 표기가 함께 있다는 사실만**
 *    적는다 — 어느 부분이 근거인지는 여기서도 판정하지 않는다.
 *
 *  ⚠ 근거끼리 겹치는 것도 적는다(overlapsSpanOf). 한투 ratio [5252:5272]는 execution
 *    [5252:5444]의 진부분 접두사다. 두 행을 나란히 그리면서 아무 말도 안 하면 서로
 *    독립적인 근거 둘로 읽히는데, 실제로는 한쪽이 다른 쪽에 통째로 들어 있다.
 *    좌표 두 쌍의 산술 관계라 사용자가 화면의 좌표 pill로 눈으로 검증할 수 있다.
 *
 * ⚠ '검증'이라는 말이 이 저장소에 세 겹으로 있다 — card.status=verified(사람 검수),
 *   Pydantic의 숫자↔인용문 대조, CI의 좌표↔원문 일치. 셋은 서로 다른 보증이고
 *   스냅숏 카드에서 성립하는 것은 세 번째뿐이다. 하나로 뭉뚱그리지 말 것.
 */
import type {
  ConditionCard,
  DisposalPriceRule,
  EvidenceSpan,
  ExecutionScheduleRule,
  RatioRule,
} from "@marginguard/engine";

/**
 * **day_counting에는 근거·좌표 표시를 붙이지 않는다.** 팀 결정으로 기록된 제약이다.
 *
 * 근거 셋:
 *  ① ExecutionScheduleRule은 evidence를 하나만 갖는데, 그 인용문과 대조되는 것은
 *     threshold_ratio뿐이다(services/ingest/app/schemas.py의
 *     `require_threshold_ratio_in_quote`). day_counting은 타입이 그냥 `str`이고
 *     validator 대상이 아니다 — 빈 문자열도 통과한다.
 *  ② 스냅숏 3장의 day_counting("D일 평가 → D+2 집행")은 **손으로 적은 값**이고
 *     인용문과 글자가 다르다. 조항으로 교체한 지금도 그렇다 — 한투는
 *     "담보부족발생(D일) + 2일", 메리츠는 "추가담보요구일로부터 1영업일 이내"이고,
 *     메리츠 쪽은 1영업일 기한 → D+1 만료 → D+2 집행이라는 한 단계 추론까지 필요하다.
 *  ③ 그런데 화면에서 가장 인용하고 싶은 값이기도 하다 — "D+2 집행"은 사용자에게
 *     가장 구체적으로 들리는 문장이다. 여기 배지를 달면 제품이 파는 주장이 무너진다.
 *
 * 나중에 "다른 필드에는 좌표가 붙는데 여기만 없어 일관성이 없다"는 이유로 배지를
 * 붙이지 말 것. 일관성의 대상은 표시 형식이 아니라 **보증의 유무**다.
 */
export const DAY_COUNTING_WHY =
  "이 표기는 위 인용문에서 뽑은 값이 아니라 카드에 적어 넣은 문장입니다. 인용문과 글자를 맞춰 보는 검사를 받지 않으므로 좌표도 근거 표시도 붙이지 않습니다. 회사 원문은 D를 예시 시작일로 잡기도 하고 관통일로 잡기도 해서 같은 절차가 D+2로도 D+3으로도 적힙니다 — 카드 표기는 관통일 기준입니다.";

export type EvidenceRole = "ratio" | "disposal" | "execution";

/**
 * 좌표 표기 — EvidenceSpan 판별 유니온을 화면이 쓰는 모양으로 좁힌 결과.
 *
 * 좁히기를 여기서 끝내는 이유: 컴포넌트가 `span.char_start`를 직접 읽으면
 * PageEvidenceSpan 가지에서 tsc가 막는다. 스냅숏 9개 스팬이 전부 문자형이라
 * 페이지형은 실데이터로 렌더된 적이 없고, 그래서 로컬에서는 안 드러나고 CI에서 터진다.
 */
export type EvidenceLocator =
  | {
      kind: "char";
      /** "5252–5272" — 좌표는 기계 주소라 천단위 구분을 넣지 않는다 */
      label: string;
      /** char_end − char_start */
      width: number;
      flattenedSha256: string;
      /** 앞 12자 + … — 64자 hex는 어디서도 줄바꿈되지 않아 그대로 두면 모바일이 가로로 넘친다 */
      shaShort: string;
    }
  | {
      kind: "page";
      /** "3쪽" 또는 "3–4쪽" */
      label: string;
      width: null;
      /** 페이지형에는 평탄화 해시가 없다 — 타입에 필드 자체가 없다 */
      flattenedSha256: null;
      shaShort: null;
    };

export interface EvidenceRow {
  role: EvidenceRole;
  /** 카드의 어느 조항인가 */
  title: string;
  /** 그 조항이 담고 있는 값의 이름 */
  field: string;
  /** 카드가 말하는 값 */
  value: string;
  /**
   * value 안에서 인용문과 글자를 맞춰 볼 수 있는 표기 하나 — "140%", "15%", "하한가".
   * 맞춰 볼 표기 자체가 없으면(예: "할인율 미기재…") null이고, 그때는 화면이
   * 있다고도 없다고도 말하지 않는다.
   */
  figure: string | null;
  /**
   * figure가 인용문에 **글자로** 있는가. figure가 null이면 null.
   * **false일 때만 화면이 말한다** — 이유는 파일 머리글의 비대칭 규약 참조.
   */
  figureInQuote: boolean | null;
  /** 원문 그대로. 자르지 않는다 */
  quote: string;
  /**
   * 인용문 실제 길이(**코드포인트**). 좌표 폭과 다를 수 있어 따로 센다.
   * `String.length`(UTF-16 코드유닛)가 아니다 — char_start/char_end는 파이썬이
   * 만든 코드포인트 오프셋이라(services/ingest의 parse_document → text[a:b]),
   * 서로게이트 쌍이 하나만 있어도 두 값이 갈려 멀쩡한 좌표가 어긋난 것으로 보인다.
   */
  quoteLength: number;
  /** 접힌 상태에 보여줄 한 줄 — 개행·탭을 공백으로 접고 잘라낸 것이라 **원문이 아니다** */
  preview: string;
  /**
   * preview가 원문과 다른가(공백을 접었거나 90자에서 줄였거나).
   * true면 접힌 줄에 "원문이 아니다"라는 라벨이 붙는다 — 90자 미만이면서 개행만 접힌
   * 인용문은 말줄임(…)조차 없어, 라벨이 없으면 접힌 문자열이 원문으로 읽힌다.
   */
  previewFolded: boolean;
  sourceFormat: EvidenceSpan["source_format"];
  /** 화면 표기 — 원시 토큰(html/text/pdf)을 라벨 없이 내보이지 않는다 */
  sourceFormatLabel: string;
  locator: EvidenceLocator;
  /**
   * 좌표 폭과 인용문 길이가 어긋나면 true — 그러면 이 좌표는 이 인용문을 설명하지
   * 못한다. 스냅숏 9개는 전부 일치하지만(CI 검사) 인제스트가 만든 카드는 보증이 없다.
   * 조용히 넘기면 화면이 틀린 좌표를 근거처럼 내보인다.
   */
  widthMismatch: boolean;
  /**
   * 앞선 행과 **완전히 같은 스팬**이면 그 행의 title. 같은 인용문을 두 번 그리지 않는다.
   * 한투 2-pass 실측에서 ratio와 execution이 같은 1,621자 블록을 근거로 반환했다 —
   * 나란히 나열하면 한 화면에 같은 표 덤프가 두 벌 쌓인다.
   *
   * ⚠ 판정은 **완전 일치**다. 스냅숏 한투는 ratio [5252:5272]와 execution [5252:5444]가
   * 시작을 공유하고 앞 20자가 겹치지만 서로 다른 스팬이라 둘 다 그려진다 — 겹침까지
   * 묶으면 "이 근거는 저 근거와 같다"는 거짓 문장을 만들게 되므로 그대로 둔다.
   * 겹친다는 사실 자체는 `overlapsSpanOf`가 따로 적는다.
   */
  sameSpanAs: string | null;
  /**
   * 같은 문서의 앞선 행과 **구간이 겹치지만 같지는 않을 때** 그 행과 겹치는 좌표.
   *
   * 스냅숏 한투가 이 경우다 — ratio [5252:5272]가 execution [5252:5444]의 **진부분
   * 접두사**라 같은 20자가 근거 상자 두 개에 통째로 중복 렌더된다. sameSpanAs는 완전
   * 일치만 보므로 둘 다 null이고, 아무 말도 하지 않으면 화면은 두 행이 서로 독립적인
   * 근거인 것처럼 내보인다. 실제로는 ratio 근거가 execution 근거에 통째로 포함돼 있어
   * **근거의 독립성이 없다.**
   *
   * 여기서 하는 말은 좌표 두 쌍의 산술 관계뿐이라(사용자가 화면의 두 좌표 pill로 눈으로
   * 검증할 수 있다) 새 보증을 만들지 않는다 — 머리글의 비대칭 규약과 같은 성격이다.
   */
  overlapsSpanOf: SpanOverlap | null;
  /**
   * 인용문 안에 있는, **옆 수치가 아닌** 다른 퍼센트 표기들. 없으면 빈 배열.
   *
   * 왜 필요한가 — figureInQuote는 "옆 수치가 인용문에 글자로 있는가"만 본다. 그래서
   * 인용문이 옆 수치를 담으면서 **동시에 카드가 모델링하지 않는 다른 값도** 담고 있는
   * 경우 화면이 완전히 침묵한다. 실측 스냅숏에서 세 행이 그렇다:
   *   · 한투 execution — '융자 140%' 옆에 '대주 120%'·'대주전용계좌 105%'가 같은 표에서
   *     딸려 왔다(140%와 '+ 2일'을 한 스팬에 담으려면 표를 끊을 수 없었다). 접힌 요약줄
   *     90자에는 그 120%·105%만 보이고 정작 집행 시점 행은 안 보인다.
   *   · 메리츠 ratio — 한 행이 'A∙B군 140% C∙D군 150%'다. 카드는 symbol_group '일반'
   *     하나에 1.4만 두므로 C∙D군 종목에는 문서 값이 150%인데 화면 값은 140%다.
   *   · 메리츠 execution — '140%~150% 미만' 구간의 기한만 규정한다. 같은 표의 '120%
   *     미만 → 당일 이내'(@8924)는 인용 밖이고 카드의 D+2와 어긋난다.
   * 셋 다 figureInQuote가 true라 기존 경고 경로에 걸리지 않는다.
   *
   * ⚠ 이것은 "옆 수치가 틀렸다"는 판정이 **아니다.** 인용문에 다른 표기도 함께 있다는
   * 사실 진술이고, 어느 부분이 근거인지는 여전히 화면이 판정하지 않는다. figure가
   * null인 행(맞춰 볼 표기 자체가 없는 행)은 빈 배열이다 — 침묵해야 할 행에
   * 말을 만들지 않는다.
   */
  otherFigures: string[];
}

/** 앞선 행과 구간이 겹칠 때의 표기 */
export interface SpanOverlap {
  /** 먼저 그린 행의 title */
  title: string;
  /** 겹치는 구간의 좌표 — "5252–5272" */
  label: string;
}

/** 근거 대조를 받지 않는 필드 — 값은 보여주되 좌표·근거 표시를 붙이지 않는다 */
export interface UnbackedField {
  field: string;
  value: string;
  why: string;
}

export interface DocIdentityView {
  /** none = 판본 식별자가 비어서 도착했다. 타입은 막지만 wire JSON은 막지 못한다 */
  kind: "review_no" | "content_sha256" | "none";
  label: string;
  /** 전체 값 — title 속성용 */
  value: string;
  /** 화면 표시용(해시는 축약) */
  short: string;
}

export interface EvidenceView {
  broker: string;
  doc: DocIdentityView;
  /** 인용이 어느 시점 판본 기준인지 — 없으면 null. 신선도 강등 화면에서 특히 필요하다 */
  verifiedAt: string | null;
  /**
   * card.status를 **무엇에 대한 검수인지 밝힌 한국어**로. 원시 토큰 그대로 내보내지
   * 않는다 — 근거 섹션 문맥에서 영어 리터럴 "verified"는 "이 인용·좌표가 검증됨"으로
   * 읽히는데, 이 저장소에서 그 말은 **사람이 카드를 검수했다**는 뜻뿐이다(머리글 ⚠).
   */
  statusLabel: string;
  rows: EvidenceRow[];
  unbacked: UnbackedField[];
  /** 근거가 하나도 없을 때 화면이 그대로 쓰는 문장. 빈칸으로 두지 않는다 */
  empty: string | null;
}

/**
 * 비율 → 퍼센트 문자열. `x * 100`은 IEEE754에서 139.99999999999997이 될 수 있어
 * 그대로 찍으면 화면에 소수점 꼬리가 나온다. 반올림으로 실제 값(1.405 등)을
 * 뭉개지 않도록 4자리까지 남기고 끝의 0만 떨어뜨린다.
 */
function pct(x: number): string {
  return `${Number((x * 100).toFixed(4))}%`;
}

/** 64자 hex는 단일 토큰이라 줄바꿈되지 않는다 — 앞자리만 보이고 전체는 title로 넘긴다 */
export function shortHash(hex: string, head = 12): string {
  return hex.length <= head ? hex : `${hex.slice(0, head)}…`;
}

/**
 * 접힌 상태의 한 줄 요약. 개행 27개·탭 37개짜리 표 덤프가 들어와도 한 줄이어야 하므로
 * 공백류를 전부 접는다. **원문이 아니다** — 화면은 이것을 인용으로 표시하지 않고,
 * 원문은 펼침 영역에 통째로 남는다.
 */
export function previewLine(quote: string, max = 90): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  // 코드포인트로 센다 — slice(0, 90)이 서로게이트 쌍 한가운데를 자르면 화면에 조각
  // 코드유닛이 남는다. 자릿수 기준도 quoteLength(코드포인트)와 같은 것을 세야 한다.
  const cps = [...flat];
  return cps.length <= max ? flat : `${cps.slice(0, max).join("")}…`;
}

/**
 * 인용문에서 표기를 찾을 때만 쓰는 정규화. services/ingest의 `_normalized_quote`가
 * 하는 것 중 이 화면에 필요한 둘만 한다 — 전각 ASCII 반각화, 숫자 사이 천단위 쉼표 제거.
 *
 * ⚠ NFKC를 쓰지 않는다. 목록 마커 ①과 뒤따르는 "40%"를 "140%"로 합쳐 **없는 근거를
 * 만든다** — schemas.py:66-68이 같은 이유로 막아 두었다. 여기서는 그 방향의 오류가
 * "없는데 없다고 말하지 않는" 침묵이 아니라 "있다고 착각해 경고를 지우는" 침묵이라
 * 위험도가 낮지만, 두 미러가 같은 이유로 같은 것을 피하는 편이 읽기 쉽다.
 */
function normalizeForSearch(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/(\d),(?=\d)/g, "$1");
}

/** 정규식 메타문자 이스케이프 — 표기에 '.'이 들어간다(12.5%) */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 표기가 인용문에 **글자로** 있는가.
 *
 * 화면은 이 결과로 **"없다"만** 말한다(머리글의 비대칭 규약). 그래서 판정은 느슨한
 * 쪽으로 둔다 — 놓치면 침묵이고, 과하게 잡으면 멀쩡한 근거에 거짓 경고가 붙는다.
 * 퍼센트 표기는 앞이 다른 숫자의 꼬리가 아닐 것만 요구한다("1140%"가 "140%"의
 * 근거가 되지 않게) — schemas.py의 `_contains_percent`와 같은 경계 조건이다.
 */
export function quoteContainsFigure(quote: string, figure: string): boolean {
  const q = normalizeForSearch(quote);
  const f = normalizeForSearch(figure);
  if (f.endsWith("%")) {
    return new RegExp(`(?:^|[^0-9.])${escapeRe(f.slice(0, -1))}\\s*%`).test(q);
  }
  return q.includes(f);
}

/**
 * 인용문에 들어 있는 퍼센트 표기 중 **옆 수치가 아닌 것들**을 순서대로, 중복 없이.
 *
 * `own`에는 그 행이 화면에 찍는 표기와 그것이 인정하는 다른 표기(여집합 등)를 전부
 * 넣는다 — 여집합으로 적힌 원문(85%)을 "다른 값"이라고 하면 거짓 경고가 된다.
 *
 * 경계 조건은 `quoteContainsFigure`와 같은 이유로 같게 잡는다: 앞이 다른 숫자의
 * 꼬리인 표기는 별개 토큰으로 읽는다("1140%"는 "140%"가 아니다). 여기서 놓치는 쪽의
 * 오류는 침묵이고, 과하게 잡는 쪽의 오류는 멀쩡한 근거에 "다른 값도 있다"는 거짓
 * 문장을 붙이는 것이라 — 애매하면 침묵 쪽으로 둔다.
 */
export function otherPercentFigures(quote: string, own: string[]): string[] {
  const q = normalizeForSearch(quote);
  const mine = new Set(own.map((f) => normalizeForSearch(f).replace(/\s+/g, "")));
  const re = /(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*%/g;
  const found: string[] = [];
  // exec 루프로 돈다 — matchAll은 lib 설정(target ES2017)에 기대게 되고, 여기서 얻는
  // 것이 없다. 정규식이 앞 한 글자를 소비하지만 "140%~150%"처럼 붙어 있는 경우도
  // 구분자('~')가 그 한 글자를 맡아 다음 표기를 놓치지 않는다.
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const token = `${m[1]}%`;
    if (mine.has(token) || found.includes(token)) continue;
    found.push(token);
  }
  return found;
}

/**
 * 좌표가 가리키는 **평탄화 결과물**의 형식. 원본 파일 형식이 아니다 —
 * 메리츠 원문은 PDF지만 pypdf가 뽑은 텍스트를 인용하므로 "text"다(snapshot.ts:74-77).
 * 원시 토큰만 찍으면 사용자가 그것을 원본 파일 형식으로 읽어, 어느 문서를 대조해야
 * 하는지에 대해 화면이 틀린 답을 준다. 라벨을 앞에 붙이고 토큰은 괄호로 남긴다 —
 * 이 패널이 이미 쓰는 "한국어 라벨(원시 필드명)" 표기와 같은 꼴이다.
 */
const SOURCE_FORMAT_LABEL: Record<EvidenceSpan["source_format"], string> = {
  html: "평탄화 HTML(html)",
  text: "평탄화 텍스트(text)",
  pdf: "PDF 쪽(pdf)",
};

/**
 * card.status 표기. **무엇을 검수했는지를 말에 담는다** — 이 저장소에서 '검증'은
 * 세 겹이고(사람 검수 / Pydantic 숫자↔인용문 대조 / CI 좌표↔원문 일치) status가
 * 말하는 것은 첫 번째뿐이다. 근거 섹션에 영어 "verified"만 찍으면 나머지 둘까지
 * 뭉뚱그린 것으로 읽힌다.
 */
export function statusLabel(status: ConditionCard["status"]): string {
  return status === "verified" ? "카드 검수 완료(verified)" : "카드 검수 전(draft)";
}

/** EvidenceSpan 유니온을 source_format으로 좁혀 화면 표기를 만든다 */
export function locate(span: EvidenceSpan): EvidenceLocator {
  if (span.source_format === "pdf") {
    const label =
      span.end_page !== undefined && span.end_page !== span.page
        ? `${span.page}–${span.end_page}쪽`
        : `${span.page}쪽`;
    return { kind: "page", label, width: null, flattenedSha256: null, shaShort: null };
  }
  return {
    kind: "char",
    label: `${span.char_start}–${span.char_end}`,
    width: span.char_end - span.char_start,
    flattenedSha256: span.flattened_sha256,
    shaShort: shortHash(span.flattened_sha256),
  };
}

/**
 * 같은 스팬인지 판정하는 서명. **인용문이 아니라 좌표가 정본이다** — 메리츠 disposal
 * 인용문은 원문에 같은 문장이 두 번 나오므로(@14999·@15111) 문자열만으로 같다고 하면
 * 안 된다. 한투 execution 인용문은 1회만 나온다 — #46 시절 좌표(54자짜리 예시 문장)가
 * 2회였던 것이고, 조항으로 교체한 뒤로는 이 서술이 메리츠 쪽에만 해당한다.
 */
function spanSignature(span: EvidenceSpan): string {
  return span.source_format === "pdf"
    ? `pdf|${span.page}|${span.end_page ?? ""}|${span.quote}`
    : `${span.source_format}|${span.flattened_sha256}|${span.char_start}|${span.char_end}`;
}

/**
 * 문서 판본 식별자. `content_sha256`(원문 바이트 해시)과 evidence의
 * `flattened_sha256`(평탄화 텍스트 해시)은 **다른 값이다** — 유진 카드에서
 * 42cb41a7… 대 94fd90f4…로 갈린다. 같은 라벨로 묶으면 "어느 판본인가"와
 * "어느 문자열의 좌표인가"를 혼동시킨다.
 *
 * ⚠ DocVersion 유니온은 판별자가 없다(`review_no`가 리터럴이 아니라 `string`).
 * 그래서 tsc는 `review_no`를 배제해도 `content_sha256`을 string으로 좁혀주지 못한다.
 * 두 필드를 각각 확인하고, **둘 다 없는 경우를 지어내지 않는다** — 타입은
 * `doc_version: {}`을 막지만 wire JSON은 타입을 통과하지 않고 들어온다(#46이 막으려던
 * 상태 그대로가 라이브 카드로 도착할 수 있다). 그때 화면이 빈 해시를 판본 식별자처럼
 * 내보이면 "어느 판본을 읽고 만든 카드인가"에 거짓으로 답하는 것이다.
 */
export function docIdentity(dv: ConditionCard["doc_version"]): DocIdentityView {
  if (dv.review_no !== undefined) {
    return {
      kind: "review_no",
      label: "심사필·심의필 번호",
      value: dv.review_no,
      short: dv.review_no,
    };
  }
  const contentSha = dv.content_sha256;
  if (contentSha !== undefined) {
    return {
      kind: "content_sha256",
      label: "원문 바이트 sha256",
      value: contentSha,
      short: shortHash(contentSha),
    };
  }
  return { kind: "none", label: "문서 판본 식별자 없음", value: "", short: "—" };
}

/** 산정 기준가 규칙이 말하는 값. 할인율이 없으면 지어내지 않고 그 사실을 문장으로 쓴다 */
function disposalValue(rule: DisposalPriceRule): string {
  if (rule.discount_basis === "lower_limit") return "하한가 기준";
  return rule.discount_rate === undefined
    ? "할인율 미기재 — 산정 기준가를 정할 수 없습니다"
    : `전일종가 −${pct(rule.discount_rate)}`;
}

/**
 * @param applicableRatioRule 유지비율 행에 그릴 조항. 엔진의 `ratioAgreement`가 좁힌
 *   결과(`RatioView.applicableRule`)를 그대로 넘긴다. 생략하면 첫 조항이다.
 *
 * ── 왜 이 인자가 필요한가 ─────────────────────────────────────────────
 * 이 행은 카드의 유지비율을 **근거 좌표·평탄화 해시와 함께 크게** 찍는다. 화면에서
 * 가장 권위 있어 보이는 표시이고, 사람은 그것을 "이 계좌에 걸리는 유지비율"로 읽는다.
 * 그런데 담보부족액·처분 수량을 만든 값은 원장 r이고, 그 r과 맞대 본 것은 엔진이
 * **좁혀서 고른 조항**이다. 여기서만 `ratio_rules[0]`을 고정으로 찍으면 룰이 여럿인
 * 카드에서 게이트와 화면이 서로 다른 조항을 보게 되고, 실측하면 두 방향으로 깨진다
 * (카드 [대주 1.7, 융자 1.4] · 원장 1.4):
 *   ① 게이트는 융자 140을 보고 통과 → 배너도 행 문구도 뜨지 않는데, 이 행은
 *      좌표·해시를 달고 170%를 찍는다. 이 PR이 없애려던 그 그림이 그대로 복원된다.
 *   ② 방향을 뒤집으면(카드 [대주 1.2, 융자 1.7]) 행 문구가 "옆 값 170%와 같지
 *      않습니다"라고 쓰는데 옆에 찍힌 값은 120%다 — 화면에 없는 값을 "옆 값"이라 부른다.
 * 그래서 **게이트가 본 조항을 이 행이 그린다.** 좁히기가 하나로 만들지 못했으면
 * (AMBIGUOUS) 남은 것 중 첫 조항을 그리고, 값이 갈렸다는 사실은 행 문구가 말한다.
 *
 * ⚠ 이 카드에 없는 조항은 그리지 않는다 — 넘어온 객체가 `card.ratio_rules`에
 *   들어 있을 때만 쓴다. 다른 카드의 좌표·해시를 이 카드의 근거로 내보내면
 *   이 파일이 보증하는 단 하나(좌표가 이 문서의 그 위치를 가리킨다)가 무너진다.
 */
export function evidenceView(
  card: ConditionCard,
  applicableRatioRule?: RatioRule,
): EvidenceView {
  const rows: EvidenceRow[] = [];
  /** 스팬 서명 → 그 스팬을 처음 그린 행의 title */
  const seen = new Map<string, string>();
  /**
   * 이미 그린 문자형 스팬들 — 겹침(포함·부분겹침) 판정용. 완전 일치는 `seen`이 맡는다.
   * 페이지형은 담지 않는다: 쪽 번호에는 문자 구간이 없어 "어디서 겹치는가"를 좌표로
   * 말할 수 없고, 말할 수 없는 것을 지어내면 이 파일의 규율을 깬다.
   */
  const drawn: { title: string; sha: string; start: number; end: number }[] = [];

  const push = (
    role: EvidenceRole,
    title: string,
    field: string,
    value: string,
    span: EvidenceSpan,
    /** 인용문과 글자를 맞춰 볼 표기. 없으면 null — 화면이 아무 말도 하지 않는다 */
    figure: string | null,
    /**
     * 같은 값을 뜻하는 다른 표기. 하나라도 걸리면 "없다"고 말하지 않는다.
     * 예: discount_rate 15%가 원문에 여집합 "85%"로 적힌 경우 —
     * schemas.py의 `include_complement`가 인정하는 형태다. 놓치는 쪽(침묵)이
     * 거짓 경고보다 안전하므로 여기서는 처분 문맥어까지 요구하지 않는다.
     */
    altFigures: string[] = [],
  ) => {
    const locator = locate(span);
    const signature = spanSignature(span);
    const first = seen.get(signature) ?? null;
    if (first === null) seen.set(signature, title);

    // 완전 일치(sameSpanAs)가 이미 "같다"고 말하는 행에는 "겹친다"를 덧붙이지 않는다 —
    // 같은 사실을 두 문장으로 말하면 둘이 다른 사실인 것처럼 읽힌다.
    let overlapsSpanOf: SpanOverlap | null = null;
    if (span.source_format !== "pdf") {
      if (first === null) {
        for (const prev of drawn) {
          if (prev.sha !== span.flattened_sha256) continue;
          const from = Math.max(prev.start, span.char_start);
          const to = Math.min(prev.end, span.char_end);
          if (from < to) {
            overlapsSpanOf = { title: prev.title, label: `${from}–${to}` };
            break;
          }
        }
        drawn.push({
          title,
          sha: span.flattened_sha256,
          start: span.char_start,
          end: span.char_end,
        });
      }
    }

    const preview = previewLine(span.quote);
    // 코드포인트로 센다 — char_start/char_end가 파이썬 코드포인트 오프셋이라
    // UTF-16 코드유닛(String.length)과 비교하면 서로게이트 쌍 하나에 멀쩡한 좌표가
    // 어긋난 것으로 판정된다(𠮷 하나에 13 대 14).
    const quoteLength = [...span.quote].length;
    rows.push({
      role,
      title,
      field,
      value,
      figure,
      figureInQuote:
        figure === null
          ? null
          : [figure, ...altFigures].some((f) => quoteContainsFigure(span.quote, f)),
      quote: span.quote,
      quoteLength,
      preview,
      previewFolded: preview !== span.quote,
      sourceFormat: span.source_format,
      sourceFormatLabel: SOURCE_FORMAT_LABEL[span.source_format],
      locator,
      widthMismatch: locator.kind === "char" && locator.width !== quoteLength,
      sameSpanAs: first,
      overlapsSpanOf,
      // figure가 null인 행은 맞춰 볼 표기 자체가 없어 화면이 침묵해야 한다 —
      // "다른 값도 있다"는 말은 "옆 값"이 있을 때만 뜻이 통한다.
      otherFigures:
        figure === null ? [] : otherPercentFigures(span.quote, [figure, ...altFigures]),
    });
  };

  // 룰 배열은 타입상 비어 있을 수 있다. 없으면 행을 만들지 않는다 — 없는 근거를
  // 그럴듯한 문구로 채우지 않는 것이 이 저장소 전체의 규율이다(fail-closed).
  // 게이트가 고른 조항이 있으면 **그것**을 그린다(머리글 참조). 이 카드에 없는
  // 객체는 쓰지 않는다 — 그러면 다른 카드의 좌표를 이 카드 근거로 내보내게 된다.
  const ratio: RatioRule | undefined =
    applicableRatioRule !== undefined && card.ratio_rules.includes(applicableRatioRule)
      ? applicableRatioRule
      : card.ratio_rules[0];
  if (ratio !== undefined) {
    push(
      "ratio",
      "담보유지비율 조항",
      "유지비율(ratio)",
      pct(ratio.ratio),
      ratio.evidence,
      pct(ratio.ratio),
    );
  }

  const disposal: DisposalPriceRule | undefined = card.disposal_price_rules[0];
  if (disposal !== undefined) {
    push(
      "disposal",
      "산정 기준가 조항",
      "기준가 규칙(discount_basis)",
      disposalValue(disposal),
      disposal.evidence,
      // 하한가형은 대조할 숫자가 없다 — 화면에 적히는 말이 "하한가"이므로 그 말을 찾는다.
      // 할인율도 기준도 없는 카드는 맞춰 볼 표기 자체가 없다(null) → 화면이 침묵한다.
      disposal.discount_basis === "lower_limit"
        ? "하한가"
        : disposal.discount_rate === undefined
          ? null
          : pct(disposal.discount_rate),
      disposal.discount_basis === "lower_limit" || disposal.discount_rate === undefined
        ? []
        : [pct(1 - disposal.discount_rate)],
    );
  }

  const execution: ExecutionScheduleRule | undefined = card.execution_schedule[0];
  if (execution !== undefined) {
    push(
      "execution",
      "집행 조항",
      "발동 임계 담보비율(threshold_ratio)",
      pct(execution.threshold_ratio),
      execution.evidence,
      pct(execution.threshold_ratio),
    );
  }

  /**
   * day_counting은 rows가 아니라 여기로 간다. 구조를 나눈 것이 곧 규약이다 —
   * 좌표·인용 블록을 그리는 코드 경로가 이 배열에는 닿지 않는다. 상세는
   * DAY_COUNTING_WHY 참조.
   */
  const unbacked: UnbackedField[] = [];
  if (execution !== undefined) {
    unbacked.push({
      field: "집행 일정 표기(day_counting)",
      value: execution.day_counting.trim() === "" ? "(값 없음)" : execution.day_counting,
      why: DAY_COUNTING_WHY,
    });
  }

  return {
    broker: card.broker,
    doc: docIdentity(card.doc_version),
    verifiedAt: card.verified_at ?? null,
    statusLabel: statusLabel(card.status),
    rows,
    unbacked,
    empty:
      rows.length === 0
        ? "이 조건카드에는 근거 좌표가 없습니다 — 화면이 인용할 원문 문장이 없습니다."
        : null,
  };
}
