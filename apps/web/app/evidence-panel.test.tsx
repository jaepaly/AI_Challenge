/**
 * 근거 표시 — **화면 출력**에 무엇이 들어가고 무엇이 안 들어가는가
 * ---------------------------------------------------------------------------
 * 뷰모델 규약은 lib/marginguard/evidence-view.test.ts가 소유한다. 여기가 소유하는
 * 것은 그 뷰모델이 **실제 마크업까지 도달하는가**다 — 뷰모델에 좌표가 있어도 JSX가
 * 안 그리면 화면에는 없는 것이고, 이 제품이 파는 주장은 화면에 있어야 성립한다.
 *
 * jsdom·@testing-library가 설치돼 있지 않고 vitest environment도 node다. 의존성을
 * 늘리는 대신 react-dom/server의 renderToStaticMarkup으로 출력 문자열을 검사한다 —
 * 이 컴포넌트는 상태가 없고(접기는 CSS <details>가 한다) 순수 표현이라 그것으로 충분하다.
 *
 * 이 테스트가 잡지 못하는 것: 레이아웃. max-height·overflow·pre-wrap이 실제로
 * 1,621자를 가두는지는 CSS이고 node 렌더로는 확인되지 않는다. 여기서 확인하는 것은
 * "잘라서 넣지 않았다"까지다.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConditionCard, Position } from "@marginguard/engine";
import { CARDS, positions } from "../lib/marginguard/snapshot";
import { evidenceView } from "../lib/marginguard/evidence-view";
import { freshnessView, type FreshnessView } from "../lib/marginguard/freshness-view";
import { ratioView, type RatioView } from "../lib/marginguard/ratio-view";
import EvidencePanel from "./evidence-panel";

/**
 * landing.tsx와 **같은 배선**으로 그린다 — 대조가 고른 조항을 뷰모델에 넘긴다.
 * 여기서만 `evidenceView(card)`를 부르면 이 파일은 룰이 하나인 카드에서만 참인
 * 화면을 검사하게 되고, 게이트와 화면이 서로 다른 조항을 보는 결함이 통과한다.
 */
const render = (card: ConditionCard, fresh?: FreshnessView, ratio?: RatioView) =>
  renderToStaticMarkup(
    <EvidencePanel
      view={evidenceView(card, ratio?.applicableRule ?? undefined)}
      fresh={fresh ?? null}
      ratio={ratio ?? null}
    />,
  );

const hantoo = CARDS.find((c) => c.key === "hantoo")!.card;
const meritz = CARDS.find((c) => c.key === "meritz")!.card;
const lower = CARDS.find((c) => c.key === "lower")!.card;

/**
 * 한 행(.evRow)만 잘라낸다 — 행 단위 표시가 옆 행으로 새지 않는지 본다.
 *
 * ⚠ **여는 태그를 `>` 까지 포함해 자르지 않는다.** 그러면 `.evRow` 에 속성이 하나
 *   붙는 순간(2026-08-25 `data-role`) **행이 하나도 안 잘려** 7건이 한꺼번에 빨개진다.
 *   화면은 멀쩡한데 검사만 깨지는 종류라, 원인을 찾는 데 시간이 든다.
 */
function row(html: string, field: string): string {
  const rows = html.split('<div class="evRow"');
  const hit = rows.find((r) => r.includes(field));
  expect(hit).toBeDefined();
  return hit!;
}

/** 접힌 상태에서 보이는 부분 = 행 머리 + <summary>. 펼침 본문(<p class="evFull">…)은 뺀다 */
function collapsed(rowHtml: string): string {
  const at = rowHtml.indexOf("</summary>");
  expect(at).toBeGreaterThan(-1);
  return rowHtml.slice(0, at);
}

/** 근거 대조 없는 필드 블록만 잘라낸다 — 여기에 좌표류가 새어들면 안 된다 */
function unbackedBlock(html: string): string {
  const at = html.indexOf('class="evUnbacked"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(at);
}

/**
 * 실계좌를 가정한 원장 r. **`ledger()` 에서 읽지 않는다** — (다) 채택 이후 합성
 * 원장은 카드에서 파생되므로, 그걸 대조 상대로 쓰면 카드를 자기 자신과 맞대 보게
 * 되어 이 검사가 항상 통과한다(#67 A-1). `ratioView` 자체를 재려면 **독립적인**
 * 제2 의견이 있어야 하고, 여기서는 그것을 상수로 세운다.
 */
const LEDGER_R = 1.4;

describe("좌표·해시가 화면 출력에 실제로 들어간다", () => {
  it("스냅숏 3종의 9개 스팬이 좌표·형식·평탄화 해시와 함께 그려진다", () => {
    for (const preset of CARDS) {
      const html = render(preset.card);
      const view = evidenceView(preset.card);

      for (const row of view.rows) {
        expect(row.locator.kind).toBe("char");
        if (row.locator.kind !== "char") continue;

        expect(html).toContain(row.locator.label); // 예: 5427–5447
        expect(html).toContain(row.locator.shaShort); // 축약 표시
        expect(html).toContain(row.locator.flattenedSha256); // 전체는 title 속성으로
        expect(html).toContain(row.sourceFormat); // html / text / pdf
      }
    }
  });

  /**
   * 메리츠 disposal 인용문은 원문에 같은 문장이 두 번 나온다('가. 담보부족계좌의
   * 임의상환' @14999와 '나. 신용융자금 미상환시 임의상환' @15111). 인용문만 보여주고
   * 좌표를 숨기면 "어느 조항인지 특정 안 됨" 상태가 되어 근거가 근거 노릇을 못 한다 —
   * 카드의 trigger는 '담보부족'이라 정본은 @14999다.
   * 그래서 좌표는 **접기 트리거(summary) 안**에 둔다 — 펼치지 않아도 보인다.
   */
  it("좌표는 접힌 상태에서도 보인다 — summary 안에 있다", () => {
    const first = (html: string) =>
      html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));

    const summary = first(render(hantoo));
    expect(summary).toContain("5427–5447");
    expect(summary).toContain("20자"); // 규모를 접힌 상태에서 가늠할 수 있다

    // 인용문이 원문에 두 번 나오는 쪽이 이 규약의 실제 이유다
    const disposal = row(render(meritz), "기준가 규칙(discount_basis)");
    expect(collapsed(disposal)).toContain("14999–15048");
  });

  it("문서 판본 식별자를 평탄화 해시와 다른 라벨로 구분해 적는다", () => {
    expect(render(hantoo)).toContain("심사필·심의필 번호");

    const html = render(lower);
    expect(html).toContain("원문 바이트 sha256");
    expect(html).toContain("42cb41a7f535…"); // 원문 바이트 해시(축약)
    expect(html).toContain("94fd90f454e6…"); // 평탄화 해시(축약) — 다른 값이다
  });

  it("인용이 어느 시점 판본 기준인지 붙는다 — 신선도 강등 화면에서 필요하다", () => {
    expect(render(hantoo)).toContain(`검증일 ${hantoo.verified_at} 판본 기준`);
    expect(render(lower)).toContain("검증일 없음"); // draft, verified_at 없음
  });
});

describe("긴 인용문을 잘라서 넣지 않는다", () => {
  /**
   * 실측 최장 인용문은 char 스팬 1,621자 / 실제 문자열 2,462자다(개행 27·탭 37짜리
   * 표 덤프). 접기를 조건부 렌더로 만들면 접힌 동안 원문이 DOM에 아예 없다 —
   * 검색도 복사도 스크린리더도 닿지 않는다. 그래서 접기는 CSS(<details>)가 하고
   * 전문은 항상 출력에 있다.
   */
  it("2,462자 표 덤프가 개행·탭까지 원문 그대로 출력에 남는다", () => {
    const head = "Ⅱ.상품개요 및 특성\n■신용거래제도 요약\n";
    const rows = Array.from(
      { length: 27 },
      (_, i) => `${i}행\t담보유지비율\t140%\t추가담보납부\t임의처분`,
    ).join("\n");
    const quote = head + rows + "가".repeat(2_462 - head.length - rows.length);
    expect(quote).toHaveLength(2_462);

    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const long: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...hantoo.ratio_rules[0]!,
          evidence: { ...span, quote, char_start: 1_405, char_end: 1_405 + 1_621 },
        },
      ],
    };

    const html = render(long);
    expect(html).toContain(quote); // 전문 — 한 글자도 잘리지 않는다
    expect(html).toContain("2,462자"); // 규모를 접힌 상태에서 알린다

    // 좌표 폭(1,621)과 인용문 길이(2,462)는 다른 것을 센다. 어긋나면 그 좌표는
    // 이 인용문을 설명하지 못하므로 조용히 넘기지 않고 화면에 적는다
    expect(html).toContain("좌표 폭 1,621자와 인용문 길이 2,462자가 다릅니다");
  });

  it("요약줄 미리보기는 개행·탭을 접어 한 줄로 만든다 — 원문은 아래에 그대로 있다", () => {
    const html = render(hantoo);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).not.toContain("\n");
    expect(html).toContain(hantoo.ratio_rules[0]!.evidence.quote);
  });
});

describe("day_counting에는 검증·좌표 배지가 붙지 않는다", () => {
  /**
   * **이 테스트를 통과시키려고 문구만 바꾸지 말 것.** 막고 있는 것은 표현이 아니라
   * 보증이다 — ExecutionScheduleRule의 인용문과 대조되는 것은 threshold_ratio뿐이고
   * day_counting은 validator가 없어 빈 문자열도 통과한다. 여기에 좌표를 붙이면
   * 화면이 없는 보증을 주장한다. 상세는 evidence-view.ts의 DAY_COUNTING_WHY.
   */
  it("day_counting 블록에 좌표·해시·인용 상자가 하나도 없다", () => {
    const html = render(hantoo);
    const block = unbackedBlock(html);

    expect(block).toContain("D일 평가 → D+2 집행"); // 값 자체는 보여준다
    // 배지가 없는 것은 **붙은 좌표**다. "대조 없음"이라고 쓰면 리드 문단("자동 대조는
    // 어느 행에도 없다")과 모순되고, 모순은 위 행들이 대조를 받았다는 쪽으로 해소된다.
    // ⚠ 막고 있는 것은 이 문구가 아니라 아래 구조 단언들이다 — 문구만 바꿔 통과시키지 말 것
    expect(block).toContain("근거 좌표 없음");
    expect(block).not.toContain("대조"); // 이 블록에 대조 여부를 시사하는 말이 없다

    expect(block).not.toContain("evLoc"); // 좌표 pill
    expect(block).not.toContain("evFull"); // 인용 상자
    expect(block).not.toContain("evQuote"); // 접기 트리거
    expect(block).not.toContain("sha256");
    expect(block).not.toContain("5427–5619"); // execution 스팬 좌표
    expect(block).not.toMatch(/\d+–\d+/); // 어떤 좌표도 새어들지 않는다
  });

  it("왜 다른지 사용자가 읽을 수 있다 — 라벨 없는 값은 위 인용문이 뒷받침한다고 읽힌다", () => {
    const block = unbackedBlock(render(hantoo));
    expect(block).toContain("인용문과 글자를 맞춰 보는 검사를 받지 않으므로");
    expect(block).toContain("D+3"); // 원문 표의 D+3과 카드의 D+2가 왜 갈리는지
  });

  /**
   * 화면 전체에서 "검증"이라는 말이 좌표에 붙지 않는지도 본다. 이 저장소에서 '검증'은
   * card.status=verified(사람 검수)이고, 좌표가 보증하는 것은 그것이 아니다.
   */
  it("좌표에 '검증됨' 성격의 배지를 붙이지 않는다 — 좌표는 위치까지만 말한다", () => {
    const html = render(hantoo);
    expect(html).toContain("그 위치에 글자 그대로 있다");
    expect(html).toContain("자동 대조는 여기 포함되지 않습니다");
    expect(html).not.toContain("약관에서 확인된 값");
    expect(html).not.toContain("대조됨");
  });
});

describe("수치와 인용문의 관계 — 화면이 갖지 않은 출처 관계를 주장하지 않는다", () => {
  /**
   * 이 패널의 제목이 "이 수치가 나온 약관 문장"이면 행마다 출처를 단언하는 것이 된다.
   * **2026-08-18 전에는 execution 행에서 그 단언이 거짓이었다** — 스냅숏 3장의
   * execution 인용문에 140%가 한 글자도 없었고, 저장소 자신의 대조기(services/ingest/
   * app/schemas.py의 require_threshold_ratio_in_quote)에 넣으면 셋 다 거부됐다.
   * 좌표를 조항으로 교체한 지금은 셋 다 140%를 담고 통과한다(아래 213-224행 테스트가
   * 그것을 단언한다).
   *
   * **그렇다고 제목을 강하게 쓰면 안 된다.** 제약이 사는 이유는 그 사실과 무관하다 —
   * 글자가 겹치는 것과 그 문장이 옆 수치를 뒷받침하는 것은 다르고(비대칭 규약,
   * evidence-view.ts 머리글), 실제로 지금도 한투 execution 인용문은 140%와 함께
   * 카드가 모델링하지 않는 120%·105%를 같이 담고 있다.
   */
  it("제목이 값↔문장의 출처 관계를 단언하지 않는다", () => {
    const html = render(hantoo);
    expect(html).toContain("<h2>조항별 약관 원문과 좌표</h2>");
    expect(html).not.toContain("이 수치가 나온 약관 문장");
  });

  /**
   * **2026-08-18 전에는 스냅숏 3장 모두 이 문구를 달고 있었다.** execution 인용문이
   * 집행 일정만 서술해 140%를 한 글자도 담지 않았기 때문이다. 좌표를 조항으로
   * 교체하면서 9개 스팬 전부가 자기 표기를 담게 됐고, 그래서 이 문구가 화면에서
   * 사라졌다 — 문구를 지운 것이 아니라 붙을 이유가 없어진 것이다.
   */
  it("스냅숏 3장 어느 행에도 '인용문에 이 표기 없음'이 붙지 않는다", () => {
    for (const preset of CARDS) {
      const html = render(preset.card);
      expect(html).not.toContain("인용문에 이 표기 없음");
      // 근거: 화면에 찍히는 표기가 인용문 안에 실제로 있다
      expect(preset.card.execution_schedule[0]!.evidence.quote).toContain("140%");
      expect(preset.card.ratio_rules[0]!.evidence.quote).toContain("140%");
    }
  });

  /**
   * **이 경로를 지우면 안 된다.** 인제스트가 만드는 카드에는 값↔인용문이 맞물린다는
   * 보증이 없다. 그리고 접기 안에 두면 "펼친 사람만 진실을 보는" 화면이 된다 — 값과
   * 인용문이 한 행에 있는 것 자체가 출처 주장으로 읽히므로, 성립하지 않는 행은
   * 펼치기 전에 이미 달라야 한다.
   */
  it("표기가 없는 인용문이 오면 접힌 상태에서 그 사실을 적는다", () => {
    const span = meritz.execution_schedule[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const scheduleOnly: ConditionCard = {
      ...meritz,
      execution_schedule: [
        {
          ...meritz.execution_schedule[0]!,
          // #46이 실제로 쓰던 인용문 — 예시 블록 안이었고 140%도 없었다
          evidence: {
            ...span,
            quote:
              "(D일)담보유지비율하회사실발생및추가담보납부요구→(D+1)추가담보납입기한일이나추가담보미납발생→(D+2)반대매매실행",
          },
        },
      ],
    };
    const exec = collapsed(row(render(scheduleOnly), "threshold_ratio"));
    expect(exec).toContain("인용문에 이 표기 없음");
    expect(exec).toContain("글자로 나오지 않습니다");
  });

  /**
   * 비대칭이 규약이다. 표기가 인용문에 있다는 것은 글자가 겹친다는 뜻뿐이고,
   * 거기에 배지를 달면 화면이 갖지 않은 대조 보증을 주장하게 된다.
   *
   * ⚠ 여기서 금지하는 것은 **긍정 방향**(확인됨/대조됨)이다. 같은 행에 붙는
   * otherFigures·overlapsSpanOf 문단은 반대 방향이라 이 금지에 걸리지 않는다 —
   * "인용문에 다른 값도 있다"·"앞 행 구간과 겹친다"는 보증을 만드는 말이 아니라
   * 화면에 나란히 놓인 것들에 대한 사실 진술이고, 사용자가 눈으로 검증할 수 있다.
   * 아래 단언이 문자열 셋을 콕 집는 이유가 그것이다(문단 유무가 아니라 방향을 본다).
   */
  it("표기가 인용문에 있는 행에는 아무 배지도 붙지 않는다 — 긍정은 만들지 않는다", () => {
    for (const preset of CARDS) {
      const html = render(preset.card);
      for (const field of [
        "유지비율(ratio)",
        "기준가 규칙(discount_basis)",
        "발동 임계 담보비율(threshold_ratio)",
      ]) {
        const r = row(html, field);
        expect(r).not.toContain("인용문에 이 표기 없음");
        expect(r).not.toContain("확인됨");
        expect(r).not.toContain("대조");
      }
      // 9개 스팬 전부 표기를 담으므로 이 문구가 화면 어디에도 없다
      expect(html.split("인용문에 이 표기 없음")).toHaveLength(1);
    }
  });

  /** 맞춰 볼 표기 자체가 없으면 있다고도 없다고도 말하지 않는다 */
  it("할인율도 기준도 없는 카드는 침묵한다 — 없는 표기를 지어내 찾지 않는다", () => {
    const noRate: ConditionCard = {
      ...hantoo,
      disposal_price_rules: [
        {
          ...hantoo.disposal_price_rules[0]!,
          discount_basis: "prev_close_pct",
          discount_rate: undefined,
        },
      ],
    };
    const r = row(render(noRate), "기준가 규칙(discount_basis)");
    expect(r).toContain("할인율 미기재");
    expect(r).not.toContain("인용문에 이 표기 없음");
  });
});

describe("인용 구간이 옆 수치 하나보다 넓을 때 — 화면이 침묵하지 않는다", () => {
  /**
   * 이 제품이 파는 문장("근거를 정확히 가리킨다")이 가장 약해지는 지점이 화면에서
   * 가장 먼저 보이는 행이었다. 한투 '집행 조항'은 값으로 threshold_ratio 140%를 찍고
   * 그 아래 요약줄에 192자 인용문의 앞 90자를 놓는데, 그 90자에 들어 있는 것은
   * 카드가 모델링하지 않는 대주(120%)·신용거래대주 전용계좌(105%) 행이다. 집행 시점을
   * 규정하는 '임의상환정리(반대매매) 담보부족발생(D일) + 2일'은 코드포인트 164 뒤라
   * 펼치기 전에는 화면에 없다.
   *
   * 그래서 사실 진술을 **접기 밖**에 놓는다. 요약줄은 CSS가 nowrap + 말줄임이라
   * 본문 폭에서 잘리지만(globals.css의 .evPreview) 이 문단은 잘리지 않는다.
   */
  it("한투 집행 조항: 인용문에 120%·105%도 있다는 사실이 접힌 상태에서 보인다", () => {
    const exec = collapsed(row(render(hantoo), "발동 임계 담보비율(threshold_ratio)"));

    expect(exec).toContain("120%, 105%");
    expect(exec).toContain("함께 들어 있습니다");
    // 값이 틀렸다는 판정이 아니다 — 어느 부분이 근거인지는 여전히 판정하지 않는다
    expect(exec).toContain("화면이 판정하지 않습니다");
    expect(exec).not.toContain("확인됨");
    expect(exec).not.toContain("대조");
  });

  /**
   * 메리츠 문서는 신용거래융자 담보유지비율을 종목군별로 A∙B군 140% / C∙D군 150%로
   * 나눈다. 카드는 symbol_group '일반' 하나에 1.4만 두므로 C∙D군 종목 보유자에게는
   * 문서 값이 150%인데 화면 값은 140%다 — 위험을 과소평가하는 방향이다.
   * figureInQuote는 '140%'가 글자로 있어 true라 기존 경고 경로가 침묵한다.
   */
  it("메리츠 유지비율: 인용문의 C∙D군 150%가 화면 값 140% 옆에서 드러난다", () => {
    const ratio = collapsed(row(render(meritz), "유지비율(ratio)"));

    expect(ratio).toContain("150%, 120%");
    expect(ratio).not.toContain("인용문에 이 표기 없음"); // 140%는 인용문에 있다
  });

  /** 값이 하나뿐인 인용문에는 붙지 않는다 — 있지도 않은 혼선을 만들지 않는다 */
  it("유진 3행에는 이 문단이 하나도 없다", () => {
    const html = render(lower);
    expect(html).not.toContain("함께 들어 있습니다");
  });

  /**
   * 한투 ratio [5427:5447]는 execution [5427:5619]의 진부분 접두사다. 두 행을 나란히
   * 그리면서 아무 말도 안 하면 서로 독립적인 근거 둘로 읽히는데, 실제로는 한쪽이
   * 다른 쪽에 통째로 들어 있다 — 근거의 독립성이 없다.
   */
  it("한투 두 행의 근거 구간이 겹친다는 사실을 좌표로 적는다", () => {
    const exec = collapsed(row(render(hantoo), "발동 임계 담보비율(threshold_ratio)"));

    expect(exec).toContain("담보유지비율 조항");
    expect(exec).toContain("5427–5447에서 겹칩니다");
    expect(exec).toContain("서로 독립적이지 않습니다");
    // 겹침은 "같다"가 아니다 — 인용 상자는 두 행 모두 그대로 그린다
    expect(exec).not.toContain("같은 문장입니다");
  });

  it("겹치지 않는 카드에는 그 문장이 없다", () => {
    expect(render(meritz)).not.toContain("겹칩니다");
    expect(render(lower)).not.toContain("겹칩니다");
  });
});

describe("접힌 상태가 펼친 내용보다 단정적이면 안 된다", () => {
  /**
   * widthMismatch 경고를 <details> 본문에만 두면, 좌표가 무효인 근거가 접힌 상태에서
   * 유효한 근거와 똑같이 보인다 — 사용자는 확정적인 좌표 pill만 보고 근거가 붙었다고
   * 읽는다. 스냅숏은 CI가 좌표를 보증하지만 인제스트가 만든 카드에는 그 보증이 없다.
   */
  it("좌표 폭이 어긋난 행은 요약줄에서도 표시된다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const quote = "담보유지비율은 회사가 정하는 바에 따른다".padEnd(110, "가");
    const bad: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...hantoo.ratio_rules[0]!,
          evidence: { ...span, quote, char_start: 1_405, char_end: 1_417 },
        },
      ],
    };

    const html = render(bad);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("좌표 폭 불일치");
    expect(summary).toContain("evLoc bad"); // 좌표 pill 자체가 정상 행과 다르게 그려진다
    // 본문의 상세 경고는 그대로 남는다
    expect(html).toContain("이 좌표는 이 인용문을 설명하지 못합니다");
  });

  it("정상 행의 요약줄에는 그 표시가 없다", () => {
    const html = render(hantoo);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).not.toContain("좌표 폭 불일치");
    expect(summary).not.toContain("evLoc bad");
  });

  /**
   * 90자를 넘으면 …가 축약을 알린다. 그런데 90자 미만이면서 개행·탭만 접힌 인용문은
   * …도 없고, 공백 치환은 길이를 바꾸지 않아 옆의 자수까지 원문과 같다 — 라벨이
   * 없으면 접힌 문자열이 원문 그 자체로 읽힌다.
   */
  it("공백을 접은 요약줄에는 원문이 아니라는 라벨이 붙는다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const quote = "제5조(임의처분)\n① 회사는 담보유지비율\t140%\t미만 시 임의처분한다.";
    expect(quote.length).toBeLessThan(90); // 말줄임이 생기지 않는 길이
    const folded: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...hantoo.ratio_rules[0]!,
          evidence: { ...span, quote, char_start: 100, char_end: 100 + quote.length },
        },
      ],
    };

    const html = render(folded);
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("미리보기");
    expect(html).toContain("줄바꿈·탭을 공백으로 접고");
    expect(html).toContain(quote); // 원문은 그대로 있다
  });

  /**
   * 유진 3행은 공백이 단일 스페이스뿐이고 90자 미만이라 접을 것이 하나도 없다.
   * (한투 execution은 반대다 — 192자라 90자에서 잘려 라벨이 붙는다. 그 대비를 아래 두
   *  단언이 함께 본다.)
   *
   * ⚠ 예전에는 이 대비를 **ratio 행**으로 잡았다. 2026-08-25 개정본이 `pdf2htmlEX`
   *   산출물이라 탭·개행이 하나도 없어져 20자짜리 ratio는 **접을 것이 없어졌다** —
   *   길이로도 안 걸린다. 그래서 «실제로 접히는 행» 자리를 execution으로 옮겼다.
   *   대비 자체는 그대로다.
   */
  it("접을 것이 없으면 라벨도 없다 — 있지도 않은 가공을 표시하지 않는다", () => {
    const html = render(lower);
    expect(html).not.toContain("미리보기");
    expect(html).not.toContain("줄바꿈·탭을 공백으로 접고");

    // 실제로 접힌 행에는 붙는다 — 라벨이 죽은 코드가 아님을 같은 자리에서 확인한다
    expect(collapsed(row(render(hantoo), "발동 임계 담보비율(threshold_ratio)"))).toContain("미리보기");
  });
});

describe("원시 토큰을 라벨 없이 내보내지 않는다", () => {
  /**
   * 메리츠 원문은 PDF인데 source_format은 "text"다 — 우리가 인용하는 대상이 PDF
   * 페이지가 아니라 pypdf가 뽑은 평탄화 텍스트이기 때문이다(snapshot.ts:74-77).
   * 화면에 "text"만 찍으면 사용자는 그것을 원본 파일 형식으로 읽는다.
   */
  it("source_format에 한국어 라벨이 붙는다 — 원본 파일 형식이 아님을 본문이 밝힌다", () => {
    expect(render(meritz)).toContain("평탄화 텍스트(text)");
    expect(render(hantoo)).toContain("평탄화 HTML(html)");
    expect(render(meritz)).toContain("원본이 PDF여도 텍스트로 평탄화해 인용했으면");
  });

  /** 근거 섹션에서 영어 "verified"는 "이 인용·좌표가 검증됨"으로 읽힌다 */
  it("card.status를 무엇에 대한 검수인지 밝혀 적는다", () => {
    expect(render(hantoo)).toContain("카드 검수 완료(verified)");
    expect(render(lower)).toContain("카드 검수 전(draft)");
  });
});

describe("신선도 만료 — 근거를 가리지는 않되 자격은 붙인다", () => {
  // 날짜를 카드에서 파생한다 — 2026-09-06 재검증에서 "2026-09-09"(31일째) 가 신선한 날이
  // 되고 "2026-08-18"(신선한 날) 이 «미래 검증일» 이 되어 둘 다 뒤집혔다.
  const dayAfter = (n: number) =>
    new Date(Date.parse(hantoo.verified_at!) + n * 86_400_000).toISOString().slice(0, 10);
  const stale = (): FreshnessView => freshnessView(hantoo, dayAfter(31));

  it("blocked에서 검수 표시가 만료됐음을 같은 섹션에 적는다", () => {
    expect(stale().mode).toBe("blocked");
    const html = render(hantoo, stale());

    expect(html).toContain("검증일로부터 31일 경과(허용 30일)");
    expect(html).toContain("위 검수 표시는 만료됐습니다");
    // 근거 자체는 그대로 보인다 — blocked는 "왜 계산을 못 하나"를 묻는 화면이다
    expect(html).toContain("5427–5447");
    expect(html).toContain(hantoo.ratio_rules[0]!.evidence.quote);
  });

  it("calculated에서는 그 문장이 없다 — blocked와 같은 문자열을 내지 않는다", () => {
    const fine = freshnessView(hantoo, hantoo.verified_at!); // 검증일 당일
    expect(fine.mode).toBe("calculated");
    const html = render(hantoo, fine);

    expect(html).not.toContain("만료됐습니다");
    expect(html).not.toBe(render(hantoo, stale())); // 두 모드의 출력이 다르다
  });

  /** 판정이 없는 동안(SSR) 자격 문장을 지어내지 않는다 */
  it("fresh가 없으면 아무 자격 문장도 붙이지 않는다", () => {
    expect(render(hantoo)).not.toContain("만료됐습니다");
    expect(render(hantoo)).not.toContain("재검증이 필요합니다");
  });

  /** draft는 한 번도 정식인 적 없는 값이라 "만료"가 틀린 문장이다 */
  it("draft(reference)에는 만료 문장을 쓰지 않는다 — 머리글의 검수 전 표시로 충분하다", () => {
    const ref = freshnessView(lower, "2026-08-18");
    expect(ref.mode).toBe("reference");
    const html = render(lower, ref);

    expect(html).toContain("카드 검수 전(draft)");
    expect(html).not.toContain("만료됐습니다");
  });
});

describe("근거가 없는 카드", () => {
  it("빈칸이 아니라 없다는 문장을 그린다", () => {
    const bare: ConditionCard = {
      ...hantoo,
      ratio_rules: [],
      disposal_price_rules: [],
      execution_schedule: [],
    };
    const html = render(bare);

    expect(html).toContain("근거 좌표가 없습니다");
    expect(html).not.toContain("<summary");
  });
});

/**
 * 유지비율이 화면의 계산과 어긋날 때 — **이 패널이 결함이 눈에 보이는 자리다.**
 *
 * 패널은 카드의 ratio를 근거 좌표·해시와 함께 크게 찍는데, 같은 화면의 담보부족액은
 * 계좌 원장의 유지비율로 산출된다. 어긋나면 "근거 있는 170%"와 "140%로 낸 부족액"이
 * 한 스크롤 안에 모순 없어 보이게 놓인다. 기존 두 경고 경로는 이걸 못 잡는다 —
 * figureInQuote·otherFigures 둘 다 인용문 vs 카드값만 보고 원장을 보지 않아서,
 * **인제스트가 조항을 정확히 뽑을수록 화면이 더 조용해진다.**
 */
describe("유지비율 대조 — 카드 값과 화면 계산이 어긋날 때", () => {
  const pos = positions(8_100)[0]!;
  const mismatch = (): ConditionCard => ({
    ...hantoo,
    ratio_rules: [{ ...hantoo.ratio_rules[0]!, ratio: 1.7 }],
  });
  const gapView = (card: ConditionCard) => ratioView(card, LEDGER_R, pos);

  it("어긋난 카드: 유지비율 행에 두 숫자가 함께 나간다 — 큰 값 옆에서", () => {
    const card = mismatch();
    const r = row(render(card, undefined, gapView(card)), "유지비율(ratio)");

    expect(r).toContain("170%"); // 카드가 적은 값 (기존 큰 숫자)
    expect(r).toContain("조건카드의 유지비율 170%로 산출했습니다"); // 부족액을 만든 값
    expect(r).toContain("계좌 원장은 같은 자리에 140%를 적고 있어 같지 않습니다");
  });

  it("접기 밖이다 — 펼치지 않은 사람에게 도달한다", () => {
    const card = mismatch();
    const r = row(render(card, undefined, gapView(card)), "유지비율(ratio)");
    expect(collapsed(r)).toContain("조건카드의 유지비율 170%로 산출했습니다");
  });

  /**
   * 지뢰: otherFigures 문단이 "카드가 값으로 두는 것은 옆의 하나뿐"이라고 단언한다.
   * 어긋난 상태에서 화면의 부족액을 만든 값은 그 하나가 아니므로, 두 문장이 정면으로
   * 부딪히기 전에 **계산이 쓴 값을 먼저** 밝혀야 한다.
   */
  it("otherFigures 문단보다 **앞에** 놓인다 — 뒤에 두면 두 문장이 부딪힌다", () => {
    const card = mismatch();
    const r = row(render(card, undefined, gapView(card)), "유지비율(ratio)");
    // (다) 채택으로 이 문장의 주어가 카드로 바뀌었다 — 앞머리로 찾는다
    const gapAt = r.indexOf("조건카드의 유지비율");
    const otherAt = r.indexOf("함께 들어 있습니다");
    expect(gapAt).toBeGreaterThan(-1);
    if (otherAt > -1) expect(gapAt).toBeLessThan(otherAt);
  });

  it("어느 쪽이 틀렸다고 말하지 않는다 — 화면이 아는 것은 '같지 않다'까지다", () => {
    const card = mismatch();
    const html = render(card, undefined, gapView(card));
    for (const word of ["카드가 틀", "원장이 틀", "잘못된", "오류", "확인됨", "대조됨"]) {
      expect(html).not.toContain(word);
    }
    expect(html).toContain("화면이 판정하지 않습니다");
  });

  it("일치하면 아무것도 그리지 않는다 — 통과에 배지를 만들지 않는다", () => {
    // 프리셋 3장은 카드 1.4 · 원장 1.4라 전부 이 경로다
    for (const preset of CARDS) {
      const withRatio = render(preset.card, undefined, gapView(preset.card));
      expect(withRatio).toBe(render(preset.card)); // 바이트 단위로 같다
      expect(withRatio).not.toContain("evRatioGap");
    }
  });

  it("ratio를 안 넘기면 아무 말도 하지 않는다 — 원장을 못 본 화면은 판정하지 않는다", () => {
    expect(render(mismatch())).not.toContain("evRatioGap");
  });

  it("유지비율 행이 없는 카드에서도 침묵하지 않는다 — 머리글 아래로 올라간다", () => {
    const noRule: ConditionCard = { ...hantoo, ratio_rules: [] };
    const html = render(noRule, undefined, gapView(noRule));

    expect(html).toContain("evRatioGap");
    expect(html).toContain("담보유지비율 조항이 없습니다");
    expect(html).toContain("계산의 기준값이 없어 임계가·담보부족액을 산출하지 않았습니다");
    // 행이 없으므로 행 안이 아니라 머리글 뒤에 있다
    expect(html.indexOf("evRatioGap")).toBeLessThan(html.indexOf('<div class="evRow"'));
  });

  it("종목군별로 값이 갈린 카드: '다르다'가 아니라 '고르지 않는다'고 말한다", () => {
    const base = hantoo.ratio_rules[0]!;
    const split: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        { ...base, ratio: 1.4, symbol_group: "A∙B군" },
        { ...base, ratio: 1.5, symbol_group: "C∙D군" },
      ],
    };
    // ⚠ 이 카드에 **없는 어휘**로 물어야 좁히기가 0 건이 되어 후보 둘이 그대로 남는다.
    //   스냅숏 기본 종목군으로 물으면 A∙B군 한 줄로 좁혀져 이 화면이 아예 안 나온다.
    const outside: Position = { ...pos, group: "일반" };
    const r = row(
      render(split, undefined, ratioView(split, LEDGER_R, outside)),
      "유지비율(ratio)",
    );

    expect(r).toContain("140%, 150%");
    expect(r).toContain("화면이 고르지 않습니다");
    expect(r).not.toContain("같지 않습니다"); // 원장 140%도 후보 안에 있다 — 거짓말이 된다
  });

  /**
   * 가장 나쁜 조합의 회귀 가드: 인제스트가 170% 조항을 **정확히** 뽑으면 인용문에
   * "170%"가 글자로 있어 figureInQuote=true이고, 기존 경고 경로는 전부 침묵한다.
   * 그때도 이 문장은 나가야 한다.
   */
  it("인용문에 카드 값이 글자로 있어 기존 경고가 전부 침묵해도 이 문장은 나간다", () => {
    const base = hantoo.ratio_rules[0]!;
    const clean: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...base,
          ratio: 1.7,
          evidence: { ...base.evidence, quote: "담보유지비율은 융자금의 170%로 한다." },
        },
      ],
    };
    const r = row(render(clean, undefined, gapView(clean)), "유지비율(ratio)");

    expect(r).not.toContain("인용문에 이 표기 없음"); // figureInQuote=true
    expect(r).not.toContain("함께 들어 있습니다"); // otherFigures 없음
    expect(r).toContain("조건카드의 유지비율 170%로 산출했습니다"); // 그래도 말한다
  });
});

/**
 * 룰이 여럿인 카드 — **게이트와 화면이 같은 조항을 보는가.**
 *
 * 이 패널은 카드의 유지비율을 좌표·평탄화 해시와 함께 크게 찍는다. 화면에서 가장
 * 권위 있어 보이는 표시이고, 사람은 그것을 "이 계좌에 걸리는 유지비율"로 읽는다.
 * 그 자리를 `ratio_rules[0]`으로 고정해 두면 좁히기가 다른 행을 고르는 순간 두
 * 방향으로 깨진다 — 통과 쪽은 **무표식으로 결함이 복원되고**(이 PR이 없애려던
 * 그 그림), 어긋남 쪽은 문구가 **화면에 없는 숫자를 "옆 값"이라 부른다.**
 *
 * `ratio_rules`에는 순서 계약이 없다(schemas/condition_card.schema.json은 minItems만
 * 건다). 융자행이 [0]이 아닌 카드는 인제스트가 표를 문서 순서대로 뽑기만 해도 나온다 —
 * 한투 인용문 자체가 융자 140 / 대주 120 / 대주전용 105 세 행을 담고 있다.
 */
describe("룰이 여럿인 카드 — 근거 행이 대조가 본 조항을 찍는다", () => {
  // ⚠ 스냅숏 기본 종목군에 기대지 않는다. 여기서 보는 것은 **좁히기 자체**라
  //   "이 카드에 없는 어휘" 가 필요하고, 기본값(A∙B군)이 바뀌면 의도가 조용히
  //   달라진다. `일반` 은 어느 원문에도 없는 값이라 그 역할에 맞다.
  const pos: Position = { ...positions(8_100)[0]!, group: "일반" };
  const base = hantoo.ratio_rules[0]!;
  const withRules = (rules: Partial<typeof base>[]): ConditionCard => ({
    ...hantoo,
    ratio_rules: rules.map((r) => ({ ...base, ...r })),
  });
  const bigValue = (html: string) => /class="evVal tnum">([^<]*)</.exec(html)?.[1];
  const gapView = (card: ConditionCard, led: number = LEDGER_R) =>
    ratioView(card, led, pos);

  it("통과: 근거로 찍는 값이 **부족액을 만든 값**이다 — 침묵이 참이 된다", () => {
    // 대주행이 첫 줄이지만 대조는 융자행 140%를 보고 통과한다. 예전에는 이때
    // 좌표·해시를 단 170%가 크게 찍히고 배너도 행 문구도 없어, 화면이
    // "근거 있는 170%" + "140%로 낸 부족액 300,000원"을 무표식으로 나란히 냈다.
    const card = withRules([
      { product_type: "신용대주", ratio: 1.7 },
      { product_type: "신용융자", ratio: 1.4 },
    ]);
    const v = gapView(card);
    expect(v.confirmed).toBe(true);

    const html = render(card, undefined, v);
    expect(bigValue(html)).toBe("140%"); // 원장과 맞대 본 그 값
    expect(html).not.toContain("evRatioGap"); // 침묵해도 되는 상태다
    expect(html).not.toContain(">170%<"); // 대조가 배제한 조항을 근거로 내세우지 않는다
  });

  it("어긋남: '옆 값'이 정말 옆에 찍힌 값이다 — 배너·행 문구·큰 숫자가 한 숫자를 말한다", () => {
    const card = withRules([
      { product_type: "신용대주", ratio: 1.2 },
      { product_type: "신용융자", ratio: 1.7 },
    ]);
    const v = gapView(card);
    const html = render(card, undefined, v);

    expect(bigValue(html)).toBe("170%");
    expect(html).toContain("계좌 원장은 같은 자리에 140%를 적고 있어 같지 않습니다");
    expect(v.banner).toContain("조건카드 170%"); // 배너도 같은 숫자를 말한다
    expect(html).not.toContain(">120%<"); // 화면에 없는 값을 "옆 값"이라 부르지 않는다
  });

  it("종목군 축에서도 같다 — 적용 조항이 [0]이 아니어도 그 조항을 찍는다", () => {
    const card = withRules([
      { symbol_group: "A∙B군", ratio: 1.4 },
      { symbol_group: "일반", ratio: 1.5 },
    ]);
    const v = gapView(card, 1.5); // pos.group="일반" → 둘째 줄로 좁혀 통과
    expect(v.confirmed).toBe(true);
    expect(bigValue(render(card, undefined, v))).toBe("150%");
  });

  it("하나로 좁히지 못하면 남은 값 **안에서** 찍는다 — 문구가 전부 나열한다", () => {
    const card = withRules([
      { symbol_group: "A∙B군", ratio: 1.4 },
      { symbol_group: "C∙D군", ratio: 1.5 },
    ]);
    const v = gapView(card); // "일반"은 이 문서에 없는 어휘 → 좁히기를 버린다
    const html = render(card, undefined, v);
    expect(v.agreement.why).toBe("AMBIGUOUS");
    expect(["140%", "150%"]).toContain(bigValue(html));
    expect(html).toContain("140%, 150%"); // 큰 숫자가 문구가 말한 값들 안에 있다
  });

  it("이 카드에 없는 조항은 근거로 그리지 않는다 — 남의 좌표를 이 카드 근거로 내지 않는다", () => {
    const mine = withRules([{ ratio: 1.4 }]);
    const alien = meritz.ratio_rules[0]!; // 다른 문서·다른 좌표
    const view = evidenceView(mine, alien);
    expect(view.rows.find((r) => r.role === "ratio")!.locator.label).toBe(
      evidenceView(mine).rows.find((r) => r.role === "ratio")!.locator.label,
    );
  });
});
