import type { EvidenceSpan } from "../src/types";

/**
 * 테스트 전용 합성 근거 좌표 — **실측이 아니다.**
 * ---------------------------------------------------------------------------
 * `evidence`가 필수가 되면서 엔진 테스트의 합성 카드도 스팬을 달아야 한다.
 * 이 픽스처는 산식·경로 시뮬 계산을 시험하려고 만든 카드에 붙는 자리표시자이고,
 * 실제 약관 좌표는 `apps/web/lib/marginguard/snapshot.ts`에만 있다(문서 3건에서
 * 뽑아 고유성과 좌표 일치를 확인한 값).
 *
 * 자리표시자인 것이 한눈에 보여야 한다 — `flattened_sha256`을 0으로 채운 것은
 * 그래서다. 실제 문서의 sha256이 전부 0일 수 없으므로, 이 값이 스냅숏이나
 * 인제스트 출력에 섞여 들어가면 즉시 눈에 띈다.
 */
export const TEST_EVIDENCE: EvidenceSpan = {
  quote: "테스트 픽스처 — 실제 약관 인용이 아님",
  source_format: "text",
  char_start: 0,
  char_end: 0,
  flattened_sha256: "0".repeat(64),
};
