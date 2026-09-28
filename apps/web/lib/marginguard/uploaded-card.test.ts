import { describe, expect, it } from "vitest";
import { toUploadedPreset, displayFilename, UPLOADED_KEY } from "./uploaded-card";

/**
 * 업로드 카드 변환 — **라벨이 검수를 주장하지 않는가**가 이 파일의 본체다.
 *
 * 인제스트 출력의 `status` 는 무조건 draft 이고(docs/team-handbook.md §5-B), 화면은 그것을 참고 모드
 * 배너로 말한다. 여기서 문구가 한 발짝 세지면 같은 화면이 두 말을 하게 된다 — `#63`
 * 에서 실제로 그랬고(배너가 "쓰지 않는다"고 적으면서 그 카드로 계산하고 있었다),
 * `#66` 이 그 문구의 사본을 저장소 전체에서 막았다.
 */

const CARD = {
  broker: "테스트증권",
  ratio_rules: [{ product_type: "융자", ratio: 1.4 }],
  account_aggregation: "max",
  disposal_price_rules: [{ discount_basis: "prev_close_pct", discount_rate: 0.15 }],
  execution_schedule: [],
  ratio_source: "clause",
  doc_version: { review_no: "26-0001" },
  status: "draft",
};

describe("업로드 카드 변환", () => {
  it("조건카드 모양이 아니면 거절한다", () => {
    for (const bad of [null, undefined, 42, "카드", {}, { broker: "x" }]) {
      const result = toUploadedPreset(bad, "a.pdf");
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("🔴 `verified` 로 와도 draft 로 낮춘다", () => {
    // 인제스트는 무조건 draft 를 내지만, 화면이 그 약속에 기대면 약속이 깨지는 날
    // 조용히 틀린다. 업로드 카드는 **정의상 사람이 대조하기 전**이다.
    const result = toUploadedPreset({ ...CARD, status: "verified" }, "a.pdf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preset.card.status).toBe("draft");
  });

  it("출처 문구가 검수를 주장하지 않는다", () => {
    const result = toUploadedPreset(CARD, "메리츠_약관.pdf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { source } = result.preset;
    expect(source).toContain("검수 전");
    // 스냅숏 프리셋이 쓰는 말들 — 사람이 대조한 카드에만 쓸 수 있다
    for (const claim of ["교차검증", "골든", "재현", "심사필", "심의필", "검증됨"]) {
      expect(source, `"${claim}" 을 쓰면 안 된다`).not.toContain(claim);
    }
  });

  it("h 라벨에 숫자를 만들지 않는다 — 화면이 카드에서 직접 읽는다", () => {
    const result = toUploadedPreset(CARD, "a.pdf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 여기서 "−15%" 를 지어내면 카드와 라벨이 갈라질 수 있는 자리가 하나 더 생긴다
    expect(result.preset.hLabel).not.toMatch(/\d/);
  });

  it("카드의 broker 를 그대로 쓴다 — 파일명에서 회사를 추측하지 않는다", () => {
    const result = toUploadedPreset(CARD, "삼성_약관.pdf");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preset.broker).toBe("테스트증권");
  });

  it("키가 고정이라 여러 번 올려도 하나만 남는다", () => {
    const a = toUploadedPreset(CARD, "a.pdf");
    const b = toUploadedPreset(CARD, "b.pdf");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.preset.key).toBe(UPLOADED_KEY);
    expect(b.preset.key).toBe(UPLOADED_KEY);
  });

  it("원본 객체를 건드리지 않는다", () => {
    const input = { ...CARD, status: "verified" };
    toUploadedPreset(input, "a.pdf");
    expect(input.status).toBe("verified");
  });
});

describe("파일명 표시", () => {
  it("확장자를 떼고 길면 줄인다", () => {
    expect(displayFilename("메리츠_신용거래설명서.pdf", 28)).toBe("메리츠_신용거래설명서");
    expect(displayFilename("a".repeat(50) + ".pdf", 10)).toBe("a".repeat(9) + "…");
  });

  it("빈 이름도 화면에 낼 수 있는 것으로 바꾼다", () => {
    expect(displayFilename(".pdf")).toBe("업로드 문서");
    expect(displayFilename("   ")).toBe("업로드 문서");
  });
});
