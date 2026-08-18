/**
 * 근거 뷰모델 — 화면이 주장해도 되는 것의 경계
 * ---------------------------------------------------------------------------
 * 이 파일이 소유하는 것: 카드에 박힌 EvidenceSpan을 화면 모양으로 좁히는 규약.
 *  ① 좌표·해시가 뷰모델에서 사라지지 않는가 (사라지면 인용문이 근거 노릇을 못 한다)
 *  ② day_counting이 좌표를 받는 자리(rows)에 들어가지 않는가
 *  ③ 긴 인용문을 잘라 보관하지 않는가 (미리보기는 별도 필드다)
 *  ④ 판별 유니온의 pdf 가지가 문자형 필드를 지어내지 않는가
 *
 * 엔진이 소유하는 것: 좌표·인용문·해시 자체. 이 파일은 값을 만들지 않는다.
 * services/ingest/tests/test_snapshot_evidence.py가 소유하는 것: 그 좌표가 실제
 * 원문을 가리키는가. **여기서는 그것을 확인하지 않는다** — 원문이 apps/web 밖에 있고
 * 평탄화가 Python 전용이라 JS로 재현하면 좌표와 sha가 즉시 무효가 된다.
 *
 * 이 테스트가 잡지 못하는 것: 좌표가 틀린 카드. 인제스트가 만든 카드의 좌표는
 * 아무도 원문과 대조하지 않는다(Pydantic은 순서·범위만 본다). widthMismatch는
 * 그중 "길이조차 안 맞는" 경우만 잡는 얕은 그물이다.
 */
import { describe, expect, it } from "vitest";
import type { ConditionCard, EvidenceSpan } from "@marginguard/engine";
import { CARDS } from "./snapshot";
import {
  DAY_COUNTING_WHY,
  docIdentity,
  evidenceView,
  locate,
  otherPercentFigures,
  previewLine,
  quoteContainsFigure,
  shortHash,
  statusLabel,
} from "./evidence-view";

const hantoo = CARDS.find((c) => c.key === "hantoo")!.card;
const meritz = CARDS.find((c) => c.key === "meritz")!.card;
const lower = CARDS.find((c) => c.key === "lower")!.card;

describe("좌표 표기 — EvidenceSpan 판별 유니온 좁히기", () => {
  it("문자형은 좌표·폭·평탄화 해시를 전부 들고 나온다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    const loc = locate(span);

    expect(loc.kind).toBe("char");
    expect(loc.label).toBe("5252–5272"); // 천단위 구분 없음 — 좌표는 기계 주소다
    expect(loc.width).toBe(20);
    expect(loc.flattenedSha256).toBe(
      "f454551cba8762c6bddd546050d2b1f1fdab444cc348308e37f0a358cbb8fde5",
    );
    expect(loc.shaShort).toBe("f454551cba87…"); // 64자 hex는 줄바꿈되지 않아 축약한다
  });

  /**
   * 스냅숏 9개 스팬은 전부 html/text라 이 가지는 **실데이터로 렌더된 적이 없다.**
   * 인제스트가 PDF를 document 블록으로 넣는 경로로 가면 그때 처음 화면에 나온다.
   * 그때 flattened_sha256을 지어내면 화면이 없는 보증을 주장한다 — null이어야 한다.
   */
  it("페이지형은 평탄화 해시를 지어내지 않는다 — 타입에 그 필드가 없다", () => {
    const pdf: EvidenceSpan = { quote: "…", source_format: "pdf", page: 3 };
    expect(locate(pdf)).toEqual({
      kind: "page",
      label: "3쪽",
      width: null,
      flattenedSha256: null,
      shaShort: null,
    });

    const spread: EvidenceSpan = { quote: "…", source_format: "pdf", page: 3, end_page: 4 };
    expect(locate(spread).label).toBe("3–4쪽");
  });
});

describe("접힌 상태의 한 줄 미리보기", () => {
  /**
   * 실측 최장 인용문은 개행 27·탭 37짜리 표 덤프다. 공백을 접지 않으면 요약줄이
   * 여러 줄로 터진다. 대신 이건 **원문이 아니다** — 원문은 quote 필드에 온전히 남는다.
   */
  it("개행·탭을 공백 하나로 접고 90자에서 말줄임한다", () => {
    const table = "머리\t칸1\t칸2\n다음\t줄";
    expect(previewLine(table)).toBe("머리 칸1 칸2 다음 줄");

    const long = "가".repeat(200);
    const preview = previewLine(long);
    expect(preview).toHaveLength(91); // 90자 + …
    expect(preview.endsWith("…")).toBe(true);
  });

  it("짧은 인용문은 말줄임 없이 그대로 — 있지도 않은 생략을 표시하지 않는다", () => {
    // 유진 execution 인용문(46자, 단일 스페이스뿐) — 접을 것이 아무것도 없다
    const quote = "140%미만시 추가납부 요구일 포함 2일(D+1)일 이내 미충족시 반대매매(D+2)";
    expect(previewLine(quote)).toBe(quote);
  });

  it("shortHash는 짧은 값을 늘리지 않는다", () => {
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("0123456789abcdef")).toBe("0123456789ab…");
  });
});

describe("문서 판본 식별자", () => {
  /**
   * content_sha256(원문 바이트 해시)과 evidence.flattened_sha256(평탄화 텍스트 해시)은
   * **다른 값이다.** 유진 카드에서 42cb41a7… 대 94fd90f4…로 갈린다. 같은 라벨로 묶으면
   * "어느 판본인가"와 "어느 문자열의 좌표인가"를 혼동시킨다.
   */
  it("심사필 번호와 원문 바이트 해시를 다른 라벨로 구분한다", () => {
    expect(docIdentity(hantoo.doc_version)).toEqual({
      kind: "review_no",
      label: "심사필·심의필 번호",
      value: "2026-0265",
      short: "2026-0265",
    });

    const byHash = docIdentity(lower.doc_version);
    expect(byHash.kind).toBe("content_sha256");
    expect(byHash.value).toBe(
      "42cb41a7f5352ec0f7bd0f751349840377c4b6d5b94ba312b88aab1aaeb18a13",
    );
    // 평탄화 해시(94fd90f4…)와 값이 겹치지 않는다
    expect(byHash.value).not.toBe(locate(lower.ratio_rules[0]!.evidence).flattenedSha256);
  });

  /**
   * 타입은 `doc_version: {}`을 막지만 wire JSON은 타입을 통과하지 않고 들어온다 —
   * #46이 막으려던 상태 그대로가 라이브 카드로 도착할 수 있다. 빈 해시를 판본
   * 식별자처럼 내보이면 "어느 판본을 읽고 만든 카드인가"에 거짓으로 답하는 것이다.
   */
  it("판본 식별자가 비어 오면 빈 해시를 식별자처럼 내보이지 않는다", () => {
    const empty = docIdentity({} as ConditionCard["doc_version"]);
    expect(empty.kind).toBe("none");
    expect(empty.label).toBe("문서 판본 식별자 없음");
    expect(empty.short).toBe("—");
  });
});

describe("근거 뷰모델 — 스냅숏 카드 3종", () => {
  it("세 조항 모두 좌표를 들고 나온다 — 인용문만 남기지 않는다", () => {
    for (const preset of CARDS) {
      const view = evidenceView(preset.card);
      expect(view.rows.map((r) => r.role)).toEqual(["ratio", "disposal", "execution"]);
      expect(view.empty).toBeNull();

      for (const row of view.rows) {
        expect(row.quote.length).toBeGreaterThan(0);
        expect(row.locator.kind).toBe("char");
        expect(row.locator.label).toMatch(/^\d+–\d+$/);
        expect(row.locator.flattenedSha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  /**
   * 좌표 폭 == 인용문 길이는 9개 스팬 전부에서 성립한다(CI가 원문과 대조한다).
   * 어긋나면 그 좌표는 그 인용문을 설명하지 못한다 — 조용히 넘기면 화면이 틀린
   * 좌표를 근거처럼 내보인다.
   */
  it("좌표 폭과 인용문 길이가 일치한다", () => {
    for (const preset of CARDS) {
      for (const row of evidenceView(preset.card).rows) {
        expect(row.widthMismatch).toBe(false);
        expect(row.locator.width).toBe(row.quoteLength);
      }
    }
  });

  it("카드가 말하는 값을 조항 옆에 적는다 — h 편차 3종이 그대로 보인다", () => {
    const value = (card: ConditionCard, role: string) =>
      evidenceView(card).rows.find((r) => r.role === role)!.value;

    expect(value(hantoo, "ratio")).toBe("140%"); // 1.4*100의 IEEE754 꼬리가 나오지 않는다
    expect(value(hantoo, "disposal")).toBe("전일종가 −15%");
    expect(value(CARDS[1]!.card, "disposal")).toBe("전일종가 −20%");
    expect(value(lower, "disposal")).toBe("하한가 기준"); // 할인율이 없는 카드
  });
});

describe("표기가 인용문에 글자로 있는가 — 화면은 이것으로 '없다'만 말한다", () => {
  /**
   * **2026-08-18 이전에는 execution 3장이 여기서 false였다.** 인용문이 집행 일정만
   * 서술해 140%를 한 글자도 담지 않았고, 저장소 자신의 대조기(services/ingest/
   * app/schemas.py의 require_threshold_ratio_in_quote)에 넣으면 셋 다 거부됐다.
   * 좌표를 조항으로 교체하면서 9개 스팬 전부가 자기 표기를 담게 됐다 —
   * 한투는 '담보유지 비율 융자 융자금의 140%'가, 메리츠는 '140%~150% 미만…'이,
   * 유진은 '140%미만시 … 반대매매(D+2)'가 execution 인용문이다.
   *
   * 이 검사가 지키는 것은 "false가 없다"가 아니라 **화면에 나란히 놓인 두 문자열이
   * 실제로 맞물린다**는 것이다. 다시 false가 생기면 화면은 그 사실을 적게 되고,
   * 그때는 문구를 지울 게 아니라 좌표를 다시 잡아야 한다.
   */
  it("스냅숏 9개 스팬 전부: 화면에 찍히는 표기가 인용문 안에 글자로 있다", () => {
    for (const preset of CARDS) {
      for (const row of evidenceView(preset.card).rows) {
        expect(row.figure).not.toBeNull();
        expect(row.figureInQuote).toBe(true);
      }
    }
  });

  /**
   * 위 검사가 초록이라고 이 경로를 지우면 안 된다 — 인제스트가 만드는 카드에는
   * 좌표·인용문이 맞물린다는 보증이 없다. 교체 전 execution 3장이 정확히 이 모양이었다.
   */
  it("표기가 인용문에 없으면 여전히 false다 — 경로가 살아 있다", () => {
    const span = hantoo.execution_schedule[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const scheduleOnly: ConditionCard = {
      ...hantoo,
      execution_schedule: [
        {
          ...hantoo.execution_schedule[0]!,
          // #46이 실제로 쓰던 인용문이다 — 규범도 아니었고 140%도 없었다
          evidence: { ...span, quote: "추가납부기한 익일 자동반대매매" },
        },
      ],
    };
    const row = evidenceView(scheduleOnly).rows.find((r) => r.role === "execution")!;
    expect(row.figure).toBe("140%");
    expect(row.figureInQuote).toBe(false);
  });

  /** 맞춰 볼 표기가 없으면 있다고도 없다고도 하지 않는다 — null은 침묵이다 */
  it("할인율도 하한가 기준도 없으면 figure가 null이다", () => {
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
    const disposal = evidenceView(noRate).rows.find((r) => r.role === "disposal")!;
    expect(disposal.figure).toBeNull();
    expect(disposal.figureInQuote).toBeNull();
  });

  /**
   * 인제스트는 할인율이 여집합(85%)으로 적힌 원문을 인정한다(schemas.py의
   * include_complement). 그런 카드에 "15%가 없습니다"를 붙이면 파이프라인이 받아들인
   * 근거에 거짓 경고를 다는 것이다 — 놓치는 쪽(침묵)이 안전하므로 여집합도 인정한다.
   */
  it("할인율은 여집합 표기도 인정한다 — 거짓 경고보다 침묵이 안전하다", () => {
    const span = hantoo.disposal_price_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const complement: ConditionCard = {
      ...hantoo,
      disposal_price_rules: [
        {
          ...hantoo.disposal_price_rules[0]!,
          evidence: { ...span, quote: "전일종가의 85% 가격으로 처분한다" },
        },
      ],
    };
    expect(evidenceView(complement).rows[1]!.figureInQuote).toBe(true);
  });

  it("다른 숫자의 꼬리를 근거로 삼지 않는다", () => {
    expect(quoteContainsFigure("담보유지비율 140%", "140%")).toBe(true);
    expect(quoteContainsFigure("담보유지비율 140 %", "140%")).toBe(true); // 사이 공백
    expect(quoteContainsFigure("담보유지비율(140%)", "140%")).toBe(true);
    expect(quoteContainsFigure("１４０％ 미만", "140%")).toBe(true); // 전각
    expect(quoteContainsFigure("1140% 미만", "140%")).toBe(false); // 앞자리가 붙은 숫자
    expect(quoteContainsFigure("2.140% 미만", "140%")).toBe(false); // 소수 꼬리
    expect(quoteContainsFigure("추가납부기한 익일 자동반대매매", "140%")).toBe(false);
  });

  it("숫자가 아닌 표기는 그대로 찾는다", () => {
    expect(quoteContainsFigure("[ 반대매매일 하한가 × ( 1 - 0.008 ) ]", "하한가")).toBe(true);
    expect(quoteContainsFigure("전일종가 대비 15% 하락", "하한가")).toBe(false);
  });
});

describe("좌표 폭 대조는 코드포인트로 센다", () => {
  /**
   * char_start/char_end는 파이썬이 만든 **코드포인트** 오프셋이고(services/ingest의
   * parse_document → text[char_start:char_end]), JS의 String.length는 UTF-16
   * 코드유닛이다. 서로게이트 쌍이 하나만 있어도 두 값이 갈려, 멀쩡한 좌표가 화면에서
   * "이 인용문을 설명하지 못한다"는 확정적 문장을 받는다.
   */
  it("비-BMP 문자가 있어도 멀쩡한 좌표를 어긋났다고 하지 않는다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const quote = "담보유지비율 𠮷 140%";
    expect(quote.length).toBe(14); // UTF-16 코드유닛
    expect([...quote].length).toBe(13); // 파이썬 len()과 같은 수

    const nonBmp: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...hantoo.ratio_rules[0]!,
          evidence: { ...span, quote, char_start: 100, char_end: 113 },
        },
      ],
    };
    const row = evidenceView(nonBmp).rows[0]!;
    expect(row.quoteLength).toBe(13);
    expect(row.widthMismatch).toBe(false);
  });

  it("실제로 어긋난 좌표는 여전히 잡는다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const off: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        { ...hantoo.ratio_rules[0]!, evidence: { ...span, char_start: 1_405, char_end: 1_417 } },
      ],
    };
    expect(evidenceView(off).rows[0]!.widthMismatch).toBe(true);
  });

  it("말줄임도 코드포인트로 자른다 — 서로게이트 쌍을 반으로 가르지 않는다", () => {
    const preview = previewLine("𠮷".repeat(100));
    expect([...preview]).toHaveLength(91); // 90자 + …
    expect(preview.includes("�")).toBe(false);
    expect([...preview].slice(0, 90).every((c) => c === "𠮷")).toBe(true);
  });
});

describe("접힌 줄이 원문인지 아닌지", () => {
  it("공백만 접혀도 원문이 아니라고 표시할 수 있어야 한다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    // 90자 미만이라 말줄임이 없고, 공백 치환은 길이를 바꾸지 않아 자수도 원문과 같다
    const quote = "제5조(임의처분)\n① 회사는 담보유지비율\t140%\t미만 시 임의처분한다.";
    const folded: ConditionCard = {
      ...hantoo,
      ratio_rules: [
        {
          ...hantoo.ratio_rules[0]!,
          evidence: { ...span, quote, char_start: 100, char_end: 100 + quote.length },
        },
      ],
    };
    const row = evidenceView(folded).rows[0]!;
    expect(row.previewFolded).toBe(true);
    expect(row.preview.includes("…")).toBe(false); // 축약 신호가 하나도 없다
    expect(row.quoteLength).toBe(quote.length); // 자수도 원문과 같다
  });

  /**
   * previewFolded는 **preview가 원문과 다른가**만 뜻한다. 있지도 않은 가공을 표시하지도,
   * 실제 가공을 숨기지도 않아야 한다.
   *
   * 조항으로 교체한 뒤 한투 3행이 전부 접힌다 — ratio·execution은 '주요내용 요약' 표
   * 행이라 탭·개행을 담고, disposal은 114자로 90자를 넘는다. 메리츠·유진 6행은 공백이
   * 단일 스페이스뿐이고 90자 미만이라 그대로다. 접힌 줄이 원문처럼 보이면 안 되므로
   * 이 구분이 화면 라벨의 근거다.
   */
  it("가공했을 때만 true다 — preview와 원문의 차이가 곧 이 값이다", () => {
    const folded: string[] = [];
    for (const preset of CARDS) {
      for (const row of evidenceView(preset.card).rows) {
        expect(row.previewFolded).toBe(row.preview !== row.quote);
        if (row.previewFolded) folded.push(`${preset.key}.${row.role}`);
      }
    }
    expect(folded).toEqual(["hantoo.ratio", "hantoo.disposal", "hantoo.execution"]);
  });
});

describe("card.status 표기", () => {
  /**
   * '검증'이 이 저장소에 세 겹으로 있다 — 사람 검수(status) / Pydantic 숫자↔인용문
   * 대조 / CI 좌표↔원문 일치. 근거 섹션 문맥에서 영어 "verified"만 찍으면 사용자는
   * 그것을 "이 인용·좌표가 검증됨"으로 읽는다.
   */
  it("무엇에 대한 검수인지 말에 담고, 원시 토큰은 괄호로만 남긴다", () => {
    expect(statusLabel("verified")).toBe("카드 검수 완료(verified)");
    expect(statusLabel("draft")).toBe("카드 검수 전(draft)");
    expect(evidenceView(hantoo).statusLabel).toBe("카드 검수 완료(verified)");
    expect(evidenceView(lower).statusLabel).toBe("카드 검수 전(draft)");
  });
});

describe("day_counting — 근거 배지를 받지 않는 유일한 필드", () => {
  /**
   * 팀 결정으로 기록된 제약이다. ExecutionScheduleRule은 evidence를 하나만 갖고,
   * 그 인용문과 대조되는 것은 threshold_ratio뿐이다(schemas.py의
   * require_threshold_ratio_in_quote). day_counting은 타입이 `str`이고 validator가
   * 없어 빈 문자열도 통과한다 — 인용문이 이 문장을 뒷받침한다는 보증이 없다.
   *
   * 구조로 막는다: 좌표를 들고 다니는 것은 `rows`뿐이고 day_counting은 `unbacked`에
   * 들어간다. UnbackedField 타입에는 locator 필드가 아예 없다.
   */
  it("rows가 아니라 unbacked로 간다 — 좌표를 들고 다니는 자료구조에 닿지 않는다", () => {
    const view = evidenceView(hantoo);

    expect(view.rows.some((r) => r.value.includes("D+2"))).toBe(false);
    expect(view.unbacked).toHaveLength(1);
    expect(view.unbacked[0]!.field).toContain("day_counting");
    expect(view.unbacked[0]!.value).toBe("D일 평가 → D+2 집행");
    expect(Object.keys(view.unbacked[0]!)).toEqual(["field", "value", "why"]);
  });

  it("왜 다른지를 값 옆에 문장으로 남긴다 — 라벨 없는 값은 위 인용문이 뒷받침한다고 읽힌다", () => {
    const why = evidenceView(hantoo).unbacked[0]!.why;
    expect(why).toBe(DAY_COUNTING_WHY);
    expect(why).toContain("좌표도 근거 표시도 붙이지 않습니다");
    // D+2 대 D+3이 왜 갈리는지까지 설명한다 — 인용문 맥락과 나란히 보이기 때문이다
    expect(why).toContain("D+3");
  });

  it("빈 문자열이면 그럴듯한 문구를 채우지 않고 값 없음을 명시한다", () => {
    const blank: ConditionCard = {
      ...hantoo,
      execution_schedule: [{ ...hantoo.execution_schedule[0]!, day_counting: "  " }],
    };
    expect(evidenceView(blank).unbacked[0]!.value).toBe("(값 없음)");
  });
});

describe("같은 스팬 중복", () => {
  /**
   * 한투 2-pass 실측에서 ratio와 execution이 **같은 1,621자 블록**을 근거로 반환했다.
   * 나란히 나열하면 같은 표 덤프가 두 벌 쌓여 그 아래 블록이 화면 밖으로 밀린다.
   * 인용문 문자열이 아니라 좌표로 판정한다 — 메리츠 disposal 인용문은 원문에 같은
   * 문장이 두 번 나오므로(@14999·@15111) 문자열 비교는 서로 다른 스팬을 같다고 말한다.
   */
  it("좌표가 같으면 뒤 행이 앞 행을 가리킨다 — 인용문을 두 벌 들고 있지 않는다", () => {
    const shared = hantoo.ratio_rules[0]!.evidence;
    const dup: ConditionCard = {
      ...hantoo,
      execution_schedule: [{ ...hantoo.execution_schedule[0]!, evidence: shared }],
    };

    const rows = evidenceView(dup).rows;
    expect(rows[0]!.sameSpanAs).toBeNull();
    expect(rows[2]!.sameSpanAs).toBe("담보유지비율 조항");
    expect(rows[2]!.locator.label).toBe(rows[0]!.locator.label); // 좌표는 그대로 남는다
  });

  /**
   * 합성이 아니라 **실제로 원문에 두 번 있는 문장**으로 잡는다. 메리츠 disposal
   * 인용문(49자)은 '가. 담보부족계좌의 임의상환'(@14999)과 '나. 신용융자금 미상환시
   * 임의상환'(@15111)에 글자 단위로 같게 나온다 — 카드의 trigger가 '담보부족'이라
   * 정본은 @14999이고, 인용문만으로는 둘이 구별되지 않는다.
   *
   * 좌표 폭도 인용문 길이와 맞다(둘 다 49자). 폭이 어긋나는 합성 스팬을 쓰면
   * widthMismatch가 켜져 실제로는 화면에 '⚠ 좌표 폭 불일치'가 붙는, 원문에서 나올 수
   * 없는 카드를 시나리오로 삼게 된다.
   */
  it("인용문이 같아도 좌표가 다르면 같은 근거로 묶지 않는다", () => {
    const span = meritz.disposal_price_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    expect(span.char_start).toBe(14_999);
    // 같은 문장의 두 번째 출현('나. 신용융자금 미상환시 임의상환' 각주) — 폭이 같다
    const elsewhere: EvidenceSpan = { ...span, char_start: 15_111, char_end: 15_160 };
    const twin: ConditionCard = {
      ...meritz,
      ratio_rules: [{ ...meritz.ratio_rules[0]!, evidence: elsewhere }],
    };

    const rows = evidenceView(twin).rows;
    expect(rows[0]!.quote).toBe(rows[1]!.quote);
    expect(rows[1]!.sameSpanAs).toBeNull();
    // 합성 좌표가 아니라 실측이므로 폭 경고가 켜지지 않는다
    expect(rows[0]!.widthMismatch).toBe(false);
    expect(rows[1]!.widthMismatch).toBe(false);
  });
});

describe("인용문이 옆 수치 말고 다른 값도 담고 있을 때", () => {
  /**
   * figureInQuote가 막지 못하는 구멍이다. "옆 수치가 인용문에 있다"가 true여도 그
   * 인용문이 **다른 값도 함께** 담고 있으면 화면은 완전히 침묵한다 — 값 하나를 크게
   * 찍어 놓고 옆 인용문에 다른 값이 섞여 있는데 아무 말이 없으면 사용자는 인용문
   * 전체가 그 하나를 뒷받침한다고 읽는다.
   *
   * 실측 스냅숏에서 정확히 세 행이 그렇다. 셋 다 figureInQuote는 true다.
   */
  it("스냅숏에서 이 사실을 적어야 하는 행은 정확히 셋이다", () => {
    const found: Record<string, string[]> = {};
    for (const preset of CARDS) {
      for (const row of evidenceView(preset.card).rows) {
        if (row.otherFigures.length > 0) found[`${preset.key}.${row.role}`] = row.otherFigures;
        // 셋 다 옆 수치 자체는 인용문에 있다 — 기존 경고 경로에는 걸리지 않는다
        expect(row.figureInQuote).toBe(true);
      }
    }
    expect(found).toEqual({
      // '융자 140%' 옆에 카드가 모델링하지 않는 대주·대주전용계좌 행이 딸려 왔다
      "hantoo.execution": ["120%", "105%"],
      // 한 행이 'A∙B군 140% C∙D군 150%'다 — 카드는 symbol_group '일반' 하나뿐이다
      "meritz.ratio": ["150%", "120%"],
      // '140%~150% 미만' 구간의 기한만 규정한다
      "meritz.execution": ["150%"],
    });
  });

  /** 옆 수치가 유일한 값인 인용문에는 붙지 않는다 — 있지도 않은 혼선을 만들지 않는다 */
  it("값이 하나뿐인 인용문 6행에는 아무것도 붙지 않는다", () => {
    const quiet = [
      evidenceView(hantoo).rows[0]!, // ratio — '담보유지 비율 융자 융자금의 140%'
      evidenceView(hantoo).rows[1]!, // disposal — 15% 하나
      evidenceView(lower).rows[0]!,
      evidenceView(lower).rows[1]!, // '하한가' — 퍼센트 자체가 없다
      evidenceView(lower).rows[2]!,
    ];
    for (const row of quiet) expect(row.otherFigures).toEqual([]);
  });

  /**
   * 여집합(85%)으로 적힌 원문은 인제스트가 인정하는 형태다(schemas.py의
   * include_complement). 그것을 "다른 값"이라고 하면 파이프라인이 받아들인 근거에
   * 거짓 문장을 붙이는 것이다 — figureInQuote가 여집합을 인정하는 것과 같은 이유다.
   */
  it("여집합 표기는 다른 값으로 세지 않는다", () => {
    const span = hantoo.disposal_price_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const complement: ConditionCard = {
      ...hantoo,
      disposal_price_rules: [
        {
          ...hantoo.disposal_price_rules[0]!,
          evidence: { ...span, quote: "전일종가의 85% 가격으로 처분한다" },
        },
      ],
    };
    const row = evidenceView(complement).rows[1]!;
    expect(row.figureInQuote).toBe(true);
    expect(row.otherFigures).toEqual([]);
  });

  /** 맞춰 볼 표기 자체가 없는 행은 침묵해야 한다 — "옆 값 말고"라는 말이 성립하지 않는다 */
  it("figure가 null이면 빈 배열이다 — 침묵할 행에 말을 만들지 않는다", () => {
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
    const row = evidenceView(noRate).rows[1]!;
    expect(row.figure).toBeNull();
    expect(row.otherFigures).toEqual([]);
  });

  it("표기 추출의 경계 조건은 quoteContainsFigure와 같다", () => {
    expect(otherPercentFigures("담보유지비율 140% 대주 120%", ["140%"])).toEqual(["120%"]);
    // 붙어 있어도 뒤 표기를 놓치지 않는다 — 구분자가 앞 한 글자를 맡는다
    expect(otherPercentFigures("140%~150% 미만", ["140%"])).toEqual(["150%"]);
    expect(otherPercentFigures("A군 140% B군 150% C군 150%", ["140%"])).toEqual(["150%"]); // 중복 제거
    expect(otherPercentFigures("１４０％ 미만 １２０％", ["140%"])).toEqual(["120%"]); // 전각
    expect(otherPercentFigures("전일종가 대비 12.5% 할인", ["12.5%"])).toEqual([]); // 소수
    expect(otherPercentFigures("반대매매수량 계산시 기준가격은 하한가로 계산", ["하한가"])).toEqual([]);
  });
});

describe("근거끼리 겹칠 때 — 완전 일치가 아니라 부분 겹침", () => {
  /**
   * 스냅숏 한투가 이 경우다. ratio [5252:5272]는 execution [5252:5444]의 **진부분
   * 접두사**라 같은 20자가 근거 상자 두 개에 통째로 중복 렌더된다. sameSpanAs는
   * 완전 일치만 보므로 둘 다 null이고, 아무 말도 안 하면 두 행이 서로 독립적인
   * 근거처럼 보인다 — 실제로는 한쪽이 다른 쪽에 통째로 들어 있다.
   */
  it("한투 execution이 ratio 구간을 포함한다는 사실을 좌표로 적는다", () => {
    const rows = evidenceView(hantoo).rows;
    expect(rows[2]!.quote.startsWith(rows[0]!.quote)).toBe(true); // 진부분 접두사
    expect(rows[2]!.sameSpanAs).toBeNull(); // 같은 스팬은 아니다
    expect(rows[2]!.overlapsSpanOf).toEqual({
      title: "담보유지비율 조항",
      label: "5252–5272", // 겹치는 구간 자체의 좌표
    });
    // 먼저 그려진 행에는 붙지 않는다 — 뒤에 올 것을 앞에서 알 수 없다
    expect(rows[0]!.overlapsSpanOf).toBeNull();
    // 같은 문서 안이라도 안 겹치는 행에는 붙지 않는다(disposal은 3342–3456)
    expect(rows[1]!.overlapsSpanOf).toBeNull();
  });

  it("겹치지 않는 카드에는 하나도 붙지 않는다", () => {
    for (const key of ["meritz", "lower"]) {
      const card = CARDS.find((c) => c.key === key)!.card;
      for (const row of evidenceView(card).rows) expect(row.overlapsSpanOf).toBeNull();
    }
  });

  /**
   * 완전 일치는 sameSpanAs가 이미 "같다"고 말한다. 거기에 "겹친다"를 덧붙이면 같은
   * 사실을 두 문장으로 말하게 되고, 둘이 다른 사실인 것처럼 읽힌다.
   */
  it("완전 일치 행에는 겹침을 덧붙이지 않는다 — 같은 사실을 두 번 말하지 않는다", () => {
    const shared = hantoo.ratio_rules[0]!.evidence;
    const dup: ConditionCard = {
      ...hantoo,
      execution_schedule: [{ ...hantoo.execution_schedule[0]!, evidence: shared }],
    };
    const rows = evidenceView(dup).rows;
    expect(rows[2]!.sameSpanAs).toBe("담보유지비율 조항");
    expect(rows[2]!.overlapsSpanOf).toBeNull();
  });

  /** 다른 문서의 좌표는 겹칠 수 없다 — 좌표는 그 평탄화 결과물 안에서만 뜻이 있다 */
  it("평탄화 해시가 다르면 좌표가 겹쳐도 겹침이 아니다", () => {
    const span = hantoo.ratio_rules[0]!.evidence;
    if (span.source_format === "pdf") throw new Error("스냅숏 카드는 전부 문자형이다");
    const otherDoc: ConditionCard = {
      ...hantoo,
      execution_schedule: [
        {
          ...hantoo.execution_schedule[0]!,
          evidence: { ...span, flattened_sha256: "0".repeat(64) },
        },
      ],
    };
    expect(evidenceView(otherDoc).rows[2]!.overlapsSpanOf).toBeNull();
  });
});

describe("근거가 없는 카드", () => {
  it("빈칸이 아니라 없다는 문장을 낸다 — 그럴듯한 문구로 채우지 않는다", () => {
    const bare: ConditionCard = {
      ...hantoo,
      ratio_rules: [],
      disposal_price_rules: [],
      execution_schedule: [],
    };
    const view = evidenceView(bare);

    expect(view.rows).toHaveLength(0);
    expect(view.unbacked).toHaveLength(0);
    expect(view.empty).toContain("근거 좌표가 없습니다");
  });
});
