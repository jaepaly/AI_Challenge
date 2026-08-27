/**
 * 스냅숏 모드 데이터 (D)
 * ---------------------------------------------------------------------------
 * KIS 미연동 상태에서 랜딩이 혼자 동작하기 위한 가상 계좌·조건카드.
 * 심사 기간(9/7 11:00~9/11 23:59) 무중단 요건 때문에 이 경로는 외부 의존이 0이어야 한다.
 *
 * 수치는 전부 packages/engine이 산출한다. 이 파일은 입력값만 보관한다.
 */
import type { ConditionCard, CreditLedger, DailyPortfolioReturn, DailyReturn, EvidenceSpan, Position } from "@marginguard/engine";
import { policyRatio } from "@marginguard/engine";

/**
 * 가상 계좌 — 한투 설명서 골든 계좌와 같은 구조(1,000주 · 융자 600만).
 *
 * ⚠ **`requiredRatio` 는 여기 없다.** 유지비율은 **카드가 정한다**(#67 A-1, (다) 채택).
 * 리터럴로 두면 그 값이 계산을 몰고, *"AI 가 약관을 읽고 엔진이 계산한다"* 는 주장이
 * 화면에서 성립하지 않는다 — 읽은 값이 계산에 닿지 않는다.
 *
 * 실측이 그 모양이었다::
 *
 *     카드만 1.5 · 원장 1.4   부족액 300,000    ← 카드를 바꿔도 안 따라온다
 *     원장만 1.5 · 카드 1.4   부족액 900,000    ← 원장이 단독 구동
 */
export const ACCOUNT = {
  qty: 1_000,
  loan: 6_000_000,
  cash: 0,
} as const;

export const TICK = 10; // 호가단위(원) — 이 가격대는 10원
export const PRICE_MIN = 5_000;
export const PRICE_MAX = 12_000;
export const PRICE_START = 10_000;

export const roundTick = (p: number) => Math.round(p / TICK) * TICK;

/**
 * 합성 신용 원장. **유지비율은 카드에서 파생시킨다.**
 *
 * `#55` 의 대조 상대가 이 값이다. 리터럴 1.4 로 두면 **카드를 바꾼 순간 대조가
 * 어긋남으로 보고 수량을 영구 차단**한다. 심사위원이 1.5 짜리 약관을 올리면 그
 * 자리에서 데모가 죽는다 — 실측으로 확인했다::
 *
 *     카드 r=1.5  원장 1.4  →  "유지비율 150%와 계좌 원장의 140%가 같지 않습니다"
 *     카드 r=1.2  원장 1.4  →  차단
 *     카드 r=1.05 원장 1.4  →  차단
 *
 * 우리가 확보한 원문 기준으로 **차단되는 쪽이 다수**다(메리츠 C∙D군 150 · 한투 대주
 * 120·대주전용 105 · 신한 105·120·170 · 미래에셋 145·120·105).
 *
 * ⚠ **이건 게이트를 무력화하는 것이 아니다.** 합성 계좌에는 애초에 **독립적인 제2
 *   의견이 없다** — "브로커가 이 계좌에 적용하는 실제 비율" 같은 것이 없는 가상 계좌다.
 *   실계좌가 붙으면 그때 원장은 진짜 제2 의견이 되고, `#55` 게이트가 그 자리에서
 *   의미를 되찾는다. 그때 이 함수를 고쳐라.
 *
 * ⚠ **`NaN` 을 쓰는 이유** — `CreditLedger.requiredRatio` 는 `number` 이고 그 타입은
 *   **경계 계약**이라(README:27, C↔A) 바꾸려면 전원 승인이 필요하다. 값을 못 정한
 *   상태를 타입 변경 없이 표현하려면 `NaN` 뿐이다. `NaN` 은 모든 비교가 거짓이라
 *   조용히 통과하지 않고, 화면은 그 전에 `policyRatio(...).resolved` 로 먼저 막는다.
 *
 * ⚠ **`pos` 를 반드시 넘겨라.** `policyRatio` 는 `pos.group` 으로 조항을 좁힌다
 *   (`policy-ratio.ts` narrowRatioRules ②). 안 넘기면 종목군 차등 카드에서
 *   **화면과 원장이 갈린다** — 헤드라인은 1.5 로 정확히 읽고 원장만 `NaN` 이 되어,
 *   화면이 *"유지비율을 숫자로 읽지 못했습니다"* 라고 **아는 것을 모른다고 말한다.**
 *   인자를 선택적으로 둔 것은 기존 검사 때문이지 생략해도 된다는 뜻이 아니다.
 */
export const ledger = (card: ConditionCard, pos?: Position): CreditLedger => {
  const p = policyRatio(card, pos);
  return {
    loan: ACCOUNT.loan,
    cash: ACCOUNT.cash,
    requiredRatio: p.resolved ? p.ratio : Number.NaN,
  };
};

/**
 * ⚠ `group` 은 **문서의 어휘**여야 한다. 예전 값 `"일반"` 은 어느 원문에도 없는
 *   우리가 지어낸 분류였고(#91 D 실측: 메리츠 행에 `기본형∙투자형 / A∙B군 / C∙D군`
 *   은 있고 `일반` 은 ❌), 그 때문에 메리츠 카드에서 **좁히기가 항상 무의미**했다 —
 *   라벨 대조가 매번 0 건이 돼 후보를 그대로 두기 때문이다.
 *
 * ⚠ 값을 바꿀 때는 **카드 쪽 `symbol_group` 과 함께** 본다. 한쪽만 옮기면 화면은
 *   안 깨지고 조용히 AMBIGUOUS 로 떨어진다 — `snapshot-symbol-group.test.ts` 가
 *   그 어긋남을 잡는다.
 */
export const positions = (prevClose: number): Position[] => [
  {
    symbol: "A0001",
    name: "가상 종목",
    qty: ACCOUNT.qty,
    prevClose,
    group: "A∙B군",
  },
];

/** 조건카드 프리셋 — h(산정 기준가 할인율) 편차 3종. 실측 근거는 data/terms/README */
export interface CardPreset {
  key: string;
  broker: string;
  label: string;
  hLabel: string;
  source: string;
  card: ConditionCard;
}

/**
 * 스냅숏 카드의 근거 좌표 — **실측이고, 조항이다.**
 * ---------------------------------------------------------------------------
 * 셋 다 `data/terms`의 원문에서 뽑았고, 다음을 확인했다:
 *   ① **좌표가 정본이다** — `flattened[char_start:char_end]`가 인용문과 글자
 *      단위로 같다. 9개 스팬 전부 성립한다.
 *   ② `flattened_sha256`이 그 평탄화 결과물의 해시다.
 *   ③ 인용문이 원문에 실제로 존재한다(지어낸 문구 차단).
 *   ④ **인용문이 조항이지 워크드 예시가 아니다.** ← 2026-08-18에 추가된 축.
 *   ⑤ 카드 값이 저장소 자신의 Pydantic(services/ingest/app/schemas.py)을 통과한다 —
 *      RatioRule·DisposalPriceRule·ExecutionScheduleRule 전부.
 *
 * ⚠ **④와 ⑤가 왜 생겼는가 — #46이 예시를 조항으로 인용했다.**
 * #46은 ①②③을 전부 통과시켰다. 그런데 **셋 중 무엇도 "이 문장이 규범인가"를 묻지
 * 않는다.** 실측 결과 9개 중 5개가 '이해를 돕기 위해 작성한 예시' 블록 안이었다:
 *
 *   한투  ratio     [1405:1472] "(1) 투자원금 400만원 … 최저담보유지비율 140%"
 *        execution [1474:1528] "추가담보납부 요구일의 … 임의처분하는 경우"
 *        disposal  [1738:1781] "전일종가(6,150원) 대비 15% 하락한 가격(5,230원)…"
 *        → 셋 다 `*투자사례 (1), (2)는 … 예시입니다`(@1280)가 지배하는 [1280,2455) 안
 *   메리츠 ratio    [2995:3010] "담보유지비율(140% 가정)"   ← 인용문이 스스로 '가정'이라 말한다
 *        execution [3039:3101] "(D일)…→(D+2)반대매매실행"  ← `◉ <예시>`(@2929) 블록 안
 *
 * 그중 **한투 ratio·disposal과 메리츠 ratio는 Pydantic까지 통과한다.** 검증기가 보는
 * 것은 "인용문 안에 140%/15%라는 글자가 있는가"뿐이고, 그 140%가 조항 값인지 예시
 * 계좌의 가정치인지는 어떤 자동 검사도 묻지 않았다. 규범성은 이 저장소에서 자동화된
 * 적이 없는 유일한 축이었다 — 그래서 **좌표로 남긴다.** 아래 각 스팬 주석에 "어느 예시
 * 구간에도 속하지 않는다"를 좌표로 적었고, `tests/test_snapshot_evidence_normativity.py`가
 * 예시 마커에서 구간을 다시 만들어 겹침을 CI에서 검사한다.
 *
 * ⚠ 유진(lower)의 3개는 셋 다 예시 구간 밖이었다 — 그쪽 결함은 ④가 아니라 ⑤였다.
 *
 * 재현 방법(services/ingest에서) — 검사 자체는 CI가 돌린다
 *   (`test_snapshot_evidence.py` ①②③ / `test_snapshot_card_validates.py` ⑤ /
 *    `test_snapshot_evidence_normativity.py` ④):
 *   from app.parsing import parse_document
 *   d = parse_document(Path("data/terms/<파일>"))
 *   j = "\n".join(u.text for u in d.units)   # 평탄화 결과물
 *   j[char_start:char_end] == quote  and  quote in j
 *   d.flattened_sha256 == 아래 값
 *
 * ⚠ **인용문이 유일하다고는 말하지 않는다.** 9개 중 8개는 1회 나오지만 메리츠
 * `disposal`은 **2회** 나온다 — '가. 담보부족계좌의 임의상환'(@14999)과 '나. 신용융자금
 * 미상환시 임의상환'(@15111)의 각주가 글자 단위로 같다. 카드의 trigger가 '담보부족'이라
 * 정본은 @14999이고 인용문만으로는 둘이 구별되지 않는다. 그래서 판정 기준을 "인용문이
 * 한 번 나온다"가 아니라 ①의 좌표 일치로 잡는다.
 *
 * ⚠ 메리츠는 PDF지만 `source_format`이 `"pdf"`가 아니라 `"text"`다. 우리가
 * 인용하는 대상이 PDF 페이지가 아니라 **pypdf가 뽑은 평탄화 텍스트**이기 때문이다.
 * `page` 좌표를 쓰려면 원본 PDF를 document 블록으로 넣는 경로여야 하는데,
 * §5-B-2 결정은 pypdf 텍스트 경로다(#43).
 *
 * ⚠ 한투 원문의 **예시 표**는 D를 예시 시작일로 라벨해 임의처분이 D+3에 온다.
 * 메리츠 **예시**는 D를 관통일로 라벨해 D+2다. 관통일 기준으로 재라벨하면 둘 다 +2이고
 * 엔진 replay(관통 → 익일 통지 → 익일 집행)와 같다. 카드의 "D+2 집행"은 관통일
 * 기준 표기다 — 한투 표만 보고 D+3으로 "고치지" 말 것. 이제 아래 인용문은 그 예시 표가
 * 아니라 조항이다: 한투는 '임의상환정리(반대매매) 담보부족발생(D일) + 2일',
 * 메리츠는 '추가담보요구일로부터 1영업일 이내', 유진은 '… 미충족시 반대매매(D+2)'.
 */
const EVIDENCE = {
  hantoo: {
    // 2026-08-25 개정본(심사필 제2026-0323호). 이전 판본(2026-0265호)은
    // `data/terms/한국투자_신용거래설명서_20260707.htm` 에 **보존본**으로 남아 있고
    // 4차 유료 실행 기록이 그것을 계속 대조한다 — 여기 좌표는 **현행본** 기준이다.
    // ⚠ 새 렌더는 pdf2htmlEX 산출물이라 **탭·개행이 하나도 없다**(옛 판본 228·246개).
    //   인용문의 구분자가 전부 공백인 것이 그 때문이고, 글자는 같다.
    sha: "8131fb2287c530eea62d19f684d170d69e5163d67ea994683f4424228268977f",
    format: "html" as const,
    ratio: {
      // 조항 — '주요내용 요약' 표의 담보유지비율 행. 예시 구간 어디에도 겹치지 않는다:
      // 앞 구간이 3007에서 끝나므로 2,420자 뒤이고, 다음 예시 마커 '(예시: 골드등급'(@5912)
      // 에서 465자 앞이다. '가정/예시/사례' 어휘도 조건절도 없는 '항목명=값' 형태의 진술이다.
      // 문서 전체에서 140%는 4번(@2012·@2554·@2935·@5443) 나오는데 앞 셋이 전부 그 예시
      // 구간 안이다 — 조항 출현은 @5443 하나뿐이고 이 20자가 그것을 담는 최소 행이다.
      quote: "담보유지 비율 융자 융자금의 140%",
      char_start: 5427,
      char_end: 5447,
    },
    disposal: {
      // 조항 — Q2 답변 본문의 산정 규칙. 예시 구간 밖이다(앞 구간이 3007에서 끝나고 이
      // 스팬은 3481에서 시작한다). 금액이 박혀 있지 않은 것이 규범/예시를 가르는 가장
      // 신뢰할 만한 문체 신호였다: 예시는 '전일종가(6,150원) 대비 15%', 조항은 '전일종가
      // 대비 15%'다. 문장 끝(마침표)까지 잡아 '전일종가의 하한가로 처분될 수 있으며'가
      // 같은 스팬에 들어온다 — 카드의 h=−15%가 상한이 아니라 산정 기준이라는 점까지 덮는다.
      quote: "반대매매는 한국거래소를 통해 진행되며 수량은 한국거래소(KRX) 전일종가 대비 15% 하락한 가격을 기준으로 산정되고, 전일종가의 하한가로 처분될 수 있으며 처분 금액은 담보부족금액을 상회할 수 있습니다.",
      char_start: 3481,
      char_end: 3595,
    },
    execution: {
      // 조항 — 같은 '주요내용 요약' 표를 담보유지비율 행(140%가 @5443)부터
      // '임의상환정리(반대매매) 담보부족발생(D일) + 2일' 행(@5591)까지 잡은 192자다.
      // 예시 구간 밖이다: 시작 5427은 앞 구간의 끝(3007)보다 2,420자 뒤, 끝 5619는 다음
      // 예시 마커(@5912)보다 293자 앞이다.
      // ⚠ **왜 이렇게 넓은가.** 집행 시점을 규정하는 조항 문장은
      //   ExecutionScheduleRule.require_threshold_ratio_in_quote에서 거부된다. 일정을
      //   서술하는 문장이 임계비율을 담지 않는 것이 자연스럽기 때문이다. 140%와 '+ 2일'을
      //   동시에 담으면서 행 경계에 정렬된 최소 구간이 이 창이다. 규칙 쪽을 고치려면
      //   경계 타입 3파일을 건드려야 하고 그건 전원 승인 사항이라 손대지 않았다.
      // ⚠ **그 대가**: 이 인용문에는 '대주 120%'·'대주전용계좌 105%'·'상환방법' 행이 함께
      //   들어 있다. 192자 전체가 D+2 집행의 근거인 것은 아니다 — 근거는 첫 행(140% @5443)과
      //   마지막 행(@5591)이고 가운데 셋은 표를 끊지 않으려고 딸려온 문맥이다.
      //   접힌 요약줄 90자에는 그 가운데 셋만 보인다. 화면이 두 곳만 하이라이트하는 처리는
      //   없지만, **접기 밖 문단으로 "인용문에 120%·105%도 함께 있다"를 적는다**
      //   (evidence-view.ts의 otherFigures) — 잘리지 않는 자리라 접힌 상태에서도 도달한다.
      // ⚠ **현행본에서는 이 인용문이 한 줄이다**(개행 0). two_pass.ts 쪽 좁히기
      //   `_native_backed_subspans` 는 행 단위로 최소 스팬을 만들므로, 이런 문서에서는
      //   넓은 인용문이 그대로 남는다 — services/ingest/tests/test_flat_render_narrowing.py
      //   가 그 성질을 고정한다.
      quote: "담보유지 비율 융자 융자금의 140% 대주 대주 시가상당액의 120% 신용거래대주 전용계좌 신용거래대주 전용계좌 담보평가액의 105% (담보증권의 유형별로 일정수준의 할인평가적용) 상환방법 상환기일 전이라도 전부 또는 일부 상환 가능 (매매에 의한 상환 시에는 당해 매매거래의 결제일에 상환) 임의상환정리(반대매매) 담보부족발생(D일) + 2일",
      char_start: 5427,
      char_end: 5619,
    },
  },
  meritz: {
    sha: "24d4ddf6428ea896d3b162b13b772496d764b2a13e31c53c976642c4d7f5ea0a",
    format: "text" as const,
    ratio: {
      // 조항 — '마. 담보유지비율'(@6652) 섹션의 표 행 전체. 예시 구간 8개 어디에도 겹치지
      // 않는다. 인용문이 '신용거래융자'·'기본형∙투자형'·'A∙B군'을 스스로 담아 값 결속이
      // 인용문만으로 성립한다.
      // 좁게 자른 [7718:7749](140%까지)도 성립하지만, 자르면 'C∙D군 150%'가 화면에서
      // 사라져 종목군 차등이 있다는 사실 자체가 안 보인다. 그래서 행 전체를 남긴다.
      // ⚠ **이 스팬은 융자 두 줄(A∙B군 140 / C∙D군 150)의 근거다**(#91 결정, B 동의).
      //   예전에는 카드가 '일반' 하나에 1.4만 두어 *"ratio=1.4의 근거로만 쓴다"*고 적혀
      //   있었는데, 그 상태에서는 **C∙D군 종목 보유자에게 문서 값이 150%인데 1.4로
      //   계산**했다 — 위험을 과소평가하는 방향이었다. 지금은 군별로 나눠 담아 그 자리가
      //   닫혔고, snapshot-symbol-group.test.ts가 적어 넣은 짝이 이 인용문 안에
      //   **글자로** 있는지를 매번 확인한다(추론이 들어가면 그건 B-2 컷이다).
      // ⚠ 같은 행의 **120%는 신용거래대주**라 융자 원장에 넣지 않는다. 인용문 안에
      //   글자로 있어서 위 검사만으로는 안 걸러지므로 상품 축을 따로 본다.
      //   figureInQuote는 '140%'가 글자로 있으니 true라 기존 경고 경로에 걸리지 않았다.
      //   그래서 화면 쪽에 otherFigures를 뒀다(evidence-view.ts) — 그 문단은 나눈 뒤에도
      //   남는다(A∙B군을 그리면 "150%, 120%", C∙D군이면 "140%, 120%").
      // ✗ 버린 좌표 [2995:3010] "담보유지비율(140% 가정)" — #46이 쓰던 값이고
      //   '◉ <예시> 투자원금 400만원…'(@2929) 블록 안이다. 인용문이 스스로 '가정'이라고
      //   말하는데도 Pydantic은 통과시켰다(140%라는 글자가 있으므로).
      quote: "구분 담보유지비율신용거래융자기본형∙투자형A∙B군 140% C∙D군 150%신용거래대주A∙B군 120%",
      char_start: 7718,
      char_end: 7774,
    },
    disposal: {
      // 조항 — '√ 신용거래융자 가. 담보부족계좌의 임의상환(반대매매)'(@14157) 산식의
      // '매도가격**' 각주. 다음 형제 항목 '나. 신용융자금 미상환시…'가 @15083이므로
      // 14157 < 14999 < 15083 — **카드의 trigger='담보부족'과 소속이 일치한다.**
      // ⚠ 이 인용문은 원문에 2번 나온다. @15111이 '나. 미상환' 쪽 각주이고 글자가 완전히
      //   같아 인용문으로는 구별되지 않는다 — **좌표가 정본이다.** 미상환 규칙을 따로
      //   만들 때만 @15111을 쓸 것.
      // ✗ 버린 좌표 [1598:1645] "반대매매 시 전일 종가 대비 20% 할인/할증된 가격 등으로
      //   반대매매대상 수량을 산정" — 예시 구간 밖이라 #46의 ④ 결함은 아니었다. 다만 Q2
      //   답변 요약이라 '등으로' 유보가 붙고 '할인/할증'을 묶어 융자 매도(할인, @14999)와
      //   대주 매수(할증, @15411)를 구분하지 않는다. 카드는 융자 담보부족 처분이다.
      quote: "매도가격 : 전일 종가 대비 20% 할인된 가격 (종목별, 고객별로 달리 정할 수 있음)",
      char_start: 14999,
      char_end: 15048,
    },
    execution: {
      // 조항 — '사. 담보유지비율 하회 시 추가담보 제공'(@7877) 섹션의 구간별 기한 표 중
      // 140%~150% 행. 예시 구간 밖이고 직후가 페이지 경계라 행 경계가 깨끗하다.
      // **문서 전체에서 임계비율과 집행기한을 한 문장에 함께 담은 유일한 규범 스팬이고,**
      // 그래서 ExecutionScheduleRule을 통과하는 유일한 execution 후보이기도 하다.
      // ⚠ 인용문이 말하는 것은 '추가담보 납입기한 = 요구일로부터 1영업일'이다. 카드의
      //   day_counting('D일 평가 → D+2 집행')을 글자로 뒷받침하지는 않는다 — 1영업일 기한
      //   → D+1 만료 → D+2 집행이라는 한 단계 추론이 필요하다. 그래서 day_counting에는
      //   여전히 좌표도 근거 배지도 붙이지 않는다(evidence-view.ts의 DAY_COUNTING_WHY).
      // ⚠ ratio 후보 중 [8884:8924]와 좌표가 같은 것이 있었다. 한 카드의 두 역할이 같은
      //   문장을 근거로 삼으면 근거의 독립성이 사라지므로 ratio는 @7718 쪽으로 분리했다.
      // ✗ 버린 좌표 [3039:3101] "(D일)담보유지비율하회사실발생및…→(D+2)반대매매실행" —
      //   #46이 쓰던 값이고 '◉ <예시>'(@2929) 블록 안의 '※ 반대매매 절차' 도해다.
      //   Pydantic도 거부했다(인용문에 140%가 없다).
      // 참고: 이 인용문은 **3단 구간표의 첫 행일 뿐이다.** 바로 뒤가 [8924:8960]
      //   '120% 미만또는 신용거래대주만 보유 시 추가담보요구일 당일 이내'이고 이어서
      //   [8960:8981] '105% 미만 추가담보요구일 당일 이내'다(둘 다 실측). 120%를
      //   관통하면 납입기한이 '당일'이라 반대매매가 D+1이므로 **인용하지 않은 두 행이
      //   카드의 day_counting(D+2)을 뒤집는다.** 카드는 threshold_ratio 1.4 한 줄만
      //   두므로 그 두 구간은 카드에도 화면에도 없다 — 유진의 2단 임계를 아래에
      //   적어둔 것과 같은 이유로 여기에도 적는다. 엔진 쪽 같은 한계는
      //   packages/engine/src/replay.ts:279에 이미 기록돼 있다(D+2 고정 → 낙관).
      //   구간을 늘리려면 execution_schedule 배열에 행을 더하는 것이지 이 좌표를
      //   넓히는 것이 아니다 — 넓히면 한 인용문이 서로 다른 기한 셋을 주장하게 된다.
      quote: "140%~150% 미만(종목군별 차등) 추가담보요구일로부터 1영업일 이내",
      char_start: 8884,
      char_end: 8924,
    },
  },
  lower: {
    sha: "94fd90f454e6b6003e2d3d9f3d008e1b0d10aa4e52af5e632e7a489fcd58f92b",
    format: "html" as const,
    ratio: {
      // 조항 — '담보부족시 반대매매' 대제목(@437) 직후 도입 조항. **좌표를 바꾸지 않았다.**
      // 유진 문서의 예시 마커는 'ex)' 두 개뿐이고 그 지배 범위는 [1183,1700) 하나인데,
      // 이 스팬은 그보다 앞이다. #46의 유진 3개는 셋 다 예시 구간 밖이었다 — 이 문서에서
      // 드러난 결함은 ④(예시 오인용)가 아니라 ⑤(Pydantic 미통과)였고 그건 execution이다.
      quote: "담보유지비율이 일정비율(140%)미만으로 하락한 경우",
      char_start: 473,
      char_end: 502,
    },
    disposal: {
      // 조항 — '04. 반대매매 순서 대상종목 순서'(@1700) 섹션의 불릿 규정. 예시 구간
      // [1183,1700) 밖이다. discount_basis="lower_limit"를 문언 그대로 진술하는 유일한
      // 조항이고 적용 범위가 전체 반대매매대상종목이라 카드와 스코프가 맞는다.
      // ✗ 버린 좌표 [807:843] "[ 반대매매일 하한가 × ( 1 - 0.008 ) ] - 전일종가" — 예시
      //   구간 밖의 규범 산식이라 #46의 ④ 결함은 아니었다. 다만 '02. 현금보유주식 매도시
      //   수량산정방법' 섹션 산식의 분모라 적용 대상이 카드(trigger='담보부족')보다 좁다.
      // ⚠ lower_limit + discount_rate=undefined 조합에서는 Pydantic이 인용문을 **전혀
      //   검사하지 않는다** — require_discount_rate_in_quote의 두 if 가드를 모두 빠져나가
      //   그대로 return한다. 즉 이 자리의 PASS는 "검증됐다"가 아니라 "검증 대상이 아니다"라는
      //   뜻이고, 적합성을 판단할 수 있는 것은 사람뿐이다. 0.008을 discount_rate로 채우려
      //   들지 말 것 — 검증기는 '0.8%'/'99.2%' 표기를 요구하는데 문서는 '0.008'로만 쓴다.
      quote: "반대매매수량 계산시 기준가격은 하한가로 계산",
      char_start: 1773,
      char_end: 1797,
    },
    execution: {
      // 조항 — '04. 반대매매 순서' 말미의 ※ 규정문. 예시 구간 [1183,1700) 밖이다.
      // 임계비율 140%와 집행일 D+2를 한 문장이 동시에 담아 ExecutionScheduleRule을
      // 통과하고, 카드의 day_counting 문언과도 맞는다.
      // ✗ 버린 좌표 [517:533] "추가납부기한 익일 자동반대매매" — #46이 쓰던 값이다. 예시
      //   구간 밖의 조항이라 규범성 결함은 없었지만 인용문에 140%가 없어 Pydantic이
      //   거부했다. 유진의 결함은 예시 오인용이 아니라 이쪽이었다.
      // 참고: [2071:2114] '120%미만시 추가납부 요구일 포함 1일 이내(D) 미충족시
      //   반대매매(D+1)'로 이 문서는 2단 임계 스케줄이다. execution_schedule은 배열이라
      //   스키마 변경 없이 2행을 담을 수 있지만, 스냅숏 카드의 범위 결정 사항이라 1단만 둔다.
      quote: "140%미만시 추가납부 요구일 포함 2일(D+1)일 이내 미충족시 반대매매(D+2)",
      char_start: 2023,
      char_end: 2069,
    },
  },
} as const;

type EvidenceKey = keyof typeof EVIDENCE;

function span(
  key: EvidenceKey,
  role: "ratio" | "disposal" | "execution",
): EvidenceSpan {
  const doc = EVIDENCE[key];
  const s = doc[role];
  return {
    quote: s.quote,
    source_format: doc.format,
    char_start: s.char_start,
    char_end: s.char_end,
    flattened_sha256: doc.sha,
  };
}

/**
 * 문서 식별자 — **둘 중 정확히 하나.** 주석이 아니라 타입이 강제한다.
 *
 * 이전에는 둘 다 선택이고 `p.doc_sha256!`로 단정했다. 그러면 둘 다 빠뜨린 호출이
 * `tsc`를 통과하고 `{ content_sha256: undefined }` → 직렬화하면 **`doc_version: {}`**,
 * 즉 이 PR이 불가능하게 만들려던 상태가 카드를 만드는 유일한 헬퍼에서 나온다(#46 리뷰).
 * 프리셋 3종이 다 채워져 있어 지금은 안 드러나지만 넷째 카드를 추가하는 사람이 밟는다.
 * `test_schema_mirrors`는 types.ts 본문을, `test_snapshot_evidence`는 좌표를 보므로
 * **둘 다 이걸 못 잡는다.** 잡는 것은 타입뿐이다.
 */
type DocIdentity =
  /** 심사필·심의필 번호가 있는 회사 */
  | { review_no: string; doc_sha256?: never }
  /** 번호가 없는 회사(유진) — 원문 바이트 sha256이 버전 식별자다 */
  | { review_no?: never; doc_sha256: string };

function makeCard(
  p: {
    evidence: EvidenceKey;
    broker: string;
    discount_basis: "prev_close_pct" | "lower_limit";
    discount_rate?: number;
    status: "verified" | "draft";
    verified_at?: string;
    /**
     * 종목군별 유지비율 — **문서가 군을 가르는 경우에만** 넘긴다.
     *
     * 안 넘기면 룰 한 줄(1.4)이다. 그 카드에서 `symbol_group` 은 **읽히지 않는다** —
     * `narrowRatioRules` 가 룰이 하나면 라벨을 아예 안 보기 때문이다(`policy-ratio.ts`
     * 의 좁히기 ②는 `candidates.length > 1` 안에 있다). 문서에 군 구분이 없는데 라벨을
     * 지어내 넣어도 계산이 안 달라지는 이유가 그것이고, 그래서 **군을 가르는 문서만**
     * 여기에 적는다.
     */
    ratios?: { symbol_group: string; ratio: number }[];
  } & DocIdentity,
): ConditionCard {
  const doc_version: ConditionCard["doc_version"] =
    p.review_no !== undefined
      ? { review_no: p.review_no }
      : { content_sha256: p.doc_sha256 };
  return {
    broker: p.broker,
    ratio_rules: (p.ratios ?? [{ symbol_group: "일반", ratio: 1.4 }]).map((r) => ({
      product_type: "신용거래융자",
      collateral_type: "주식",
      symbol_group: r.symbol_group,
      ratio: r.ratio,
      evidence: span(p.evidence, "ratio"),
    })),
    account_aggregation: "max",
    disposal_price_rules: [
      {
        trigger: "담보부족",
        symbol_group: "일반",
        discount_basis: p.discount_basis,
        discount_rate: p.discount_rate,
        source_confidence: "explicit",
        evidence: span(p.evidence, "disposal"),
      },
    ],
    execution_schedule: [
      {
        threshold_ratio: 1.4,
        day_counting: "D일 평가 → D+2 집행",
        evidence: span(p.evidence, "execution"),
      },
    ],
    ratio_source: "clause",
    doc_version,
    status: p.status,
    verified_at: p.verified_at,
  };
}

export const CARDS: CardPreset[] = [
  {
    key: "hantoo",
    broker: "한국투자",
    label: "한국투자",
    hLabel: "−15%",
    source: "신용거래설명서 심사필 제2026-0323호 · 골든 195주 재현",
    card: makeCard({
      evidence: "hantoo",
      broker: "한국투자",
      discount_basis: "prev_close_pct",
      discount_rate: 0.15,
      review_no: "2026-0323",
      status: "verified",
      verified_at: "2026-08-09",
    }),
  },
  {
    key: "meritz",
    broker: "메리츠",
    label: "메리츠",
    hLabel: "−20%",
    source: "신용거래설명서 심의필 제25-125호 · 교차검증 309주",
    card: makeCard({
      evidence: "meritz",
      broker: "메리츠",
      discount_basis: "prev_close_pct",
      discount_rate: 0.2,
      review_no: "25-125",
      status: "verified",
      verified_at: "2026-08-09",
      // 문서가 군을 가른다 — 짝이 **인용 스팬 안에 글자로** 있다(#91 D 실측):
      //   t[7718:7774] "…신용거래융자기본형∙투자형A∙B군 140% C∙D군 150%신용거래대주A∙B군 120%"
      // 추론이 들어가지 않으므로 B-2 컷(인제스트 자동 추출)과 다른 층이다.
      // 120% 는 **신용거래대주** 행이라 여기 넣지 않는다 — 이 원장은 융자 원장이다.
      ratios: [
        { symbol_group: "A∙B군", ratio: 1.4 },
        { symbol_group: "C∙D군", ratio: 1.5 },
      ],
    }),
  },
  {
    key: "lower",
    broker: "하한가형",
    label: "하한가형",
    hLabel: "하한가",
    source:
      "유진 안내 페이지 '기준가격은 하한가로 계산' — 실측 카드 미확보(참고 모드)",
    card: makeCard({
      evidence: "lower",
      broker: "하한가형(예시)",
      discount_basis: "lower_limit",
      doc_sha256:
        "42cb41a7f5352ec0f7bd0f751349840377c4b6d5b94ba312b88aab1aaeb18a13",
      status: "draft",
    }),
  },
];

/**
 * 2026년 7월 연쇄 — 정수 bp. A의 replay()가 소비한다.
 * 출처·압축 라벨은 packages/engine 골든(data/golden) 및 PR #8 참조.
 * 7/28 −10.84%는 7/29 종가에서 역산한 교차검증값. 8월 말 KRX 확정치 대조 예정.
 */
export const JULY_SEQ: DailyReturn[] = [
  { date: "2026-07-07", bp: -491 },
  { date: "2026-07-08", bp: -535 },
  { date: "2026-07-13", bp: -895 },
  { date: "2026-07-24", bp: -572 },
  { date: "2026-07-28", bp: -1084 },
  { date: "2026-07-29", bp: -598 },
];

/** 표시 규약 — 담보비율은 내림. 판정은 원시값, 골든 재현은 사사오입(PR #2 3단 합의) */
export const displayRatio = (V: number, L: number) =>
  L <= 0 ? null : Math.floor((V * 100) / L);

export const won = (n: number) =>
  // ⚠ 유한하지 않으면 "NaN원"을 찍지 않는다. 카드가 유지비율을 못 정하면 파생값이
  //   전부 NaN 이 되는데, 그때 화면이 숫자처럼 생긴 것을 내면 안 된다(#67 A-1).
  Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "—";

/**
 * 자발적 매도 제비용률 — **가정치다. 약관 원문 근거가 없다.**
 *
 * 조건카드에서 나오는 r·h와 성질이 완전히 다르다. r·h는 약관 조항에 명문으로
 * 있고 근거 좌표가 붙지만, 이 값은 위탁수수료·거래세·유관기관수수료를 합친
 * 업계 통상치를 우리가 고른 것이다. 그래서 화면에서 "산정 방식 재현값" 라벨을
 * 공유하지 않고 **"가정"이라고 명시**해야 한다(규율 ② 출처 없는 수치).
 *
 * 표시 문구를 만들 때 이 상수에서 퍼센트를 뽑아 쓴다 — 코드와 화면이 갈라지면
 * 그게 곧 "화면이 근거를 잘못 말하는" 상태다.
 */
export const ASSUMED_FEE_RATE = 0.008;
export const assumedFeePct = (ASSUMED_FEE_RATE * 100).toFixed(1); // "0.8"

/* ── 다종목 스냅숏 (D) ───────────────────────────────────────────────────
 * 단일 종목 화면이 답하지 못하는 질문이 하나 있다 — "내 계좌엔 종목이 여러 개인데?"
 *
 * 계좌 규모는 단일 종목 계좌와 나란히 읽히도록 융자 600만·유지비율 140%로 맞췄다.
 * 평가액 합계 1,000만이라 버퍼가 160만이고, 그래서 λ*가 정확히 16%다.
 *
 * ⚠ cash는 0이어야 한다 — 엔진이 현금 우선 상환을 모델링하지 않았고,
 *   미반영은 낙관 방향이라 replayPortfolio가 cash>0을 아예 거부한다(#23).
 */
export const PORTFOLIO_POSITIONS: Position[] = [
  {
    symbol: "A0001",
    name: "가상 종목 갑",
    qty: 400,
    prevClose: 12_000,
    group: "A∙B군",
  },
  {
    symbol: "A0002",
    name: "가상 종목 을",
    qty: 300,
    prevClose: 10_000,
    group: "A∙B군",
  },
  {
    symbol: "A0003",
    name: "가상 종목 병",
    qty: 500,
    prevClose: 4_400,
    group: "A∙B군",
  },
];

/**
 * 다종목 재생용 원장. `ledger()` 와 같은 이유로 카드에서 파생시킨다 —
 * 여기만 1.4 로 두면 **같은 화면에서 단일 종목과 다종목이 다른 r 로 계산**한다.
 *
 * ⚠ **원장 하나에 종목군 하나를 가정한다.** `CreditLedger.requiredRatio` 는 스칼라라
 *   종목마다 다른 r 을 실을 자리가 없다. 지금은 `PORTFOLIO_POSITIONS` 가 전부 같은
 *   종목군이라 아무 포지션으로 좁혀도 같은 답이 나오고, 그 전제를
 *   `snapshot-symbol-group.test.ts` 의 *"다종목 포지션은 전부 같은 종목군이다"* 가
 *   지킨다. 섞인 포트폴리오를 넣는 날 그 검사가 먼저 넘어진다 — 그때 이 함수가 아니라
 *   **경계 계약**을 고쳐라.
 *
 * ⚠ 이 자리는 원래 `test_portfolio_single_group`(portfolio.test.ts) 을 가리키고
 *   있었는데 **그 검사는 어느 브랜치에도 없었다**(`#91` 조건② 를 받으면서 확인).
 *   지켜 준다고 적힌 것을 실제로는 아무것도 안 지키고 있었다.
 */
export const portfolioLedger = (card: ConditionCard, pos?: Position): CreditLedger => {
  const p = policyRatio(card, pos);
  return {
    loan: 6_000_000,
    cash: 0,
    requiredRatio: p.resolved ? p.ratio : Number.NaN,
  };
};

/**
 * 다종목 재생 입력 — **전 종목에 같은 일간 등락을 적용한 균등 시나리오다.**
 *
 * 날짜와 등락폭은 JULY_SEQ(실측)를 그대로 쓰지만, **종목별 실제 등락은 서로 다르다.**
 * 종목별 실데이터 스냅숏은 아직 없다(8/24 전 확보 예정). 지어낸 종목별 수익률을
 * "7월에 실제로 있었던 일"로 내보내면 그 순간 이 제품의 주장이 거짓이 된다.
 *
 * 그래서 이 재생이 증명하는 것은 **역사 재현이 아니라 배분 규칙**이다 —
 * 같은 충격에서 종목번호 순으로 어떻게 처분이 배분되는지.
 */
export const portfolioJuly = (): DailyPortfolioReturn[] =>
  JULY_SEQ.map((d) => ({
    date: d.date,
    bySymbol: Object.fromEntries(
      PORTFOLIO_POSITIONS.map((p) => [p.symbol, d.bp]),
    ),
  }));
