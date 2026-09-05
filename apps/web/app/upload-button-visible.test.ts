/**
 * 파일 선택이 **버튼처럼 보이는가.**
 *
 * 2026-09-04 배포본에서 이렇게 나왔다 — 팀장이 화면을 보고 *"버튼처럼 안 생겼는데,
 * 그냥 텍스트처럼 생김"* 이라고 했고, 배포본에서 계산 스타일을 재니 사실이었다.
 *
 *     input.appearance              none
 *     ::file-selector-button        background rgba(0,0,0,0)
 *                                   border 0px · padding 0px · color --ink3
 *
 * Tailwind preflight 가 폼 컨트롤의 네이티브 모양을 끄는데 우리가 다시 그려 주지
 * 않았다. 배경도 테두리도 여백도 없으니 **흐린 글자**다.
 *
 * 🔴 이건 조판 취향이 아니라 **제출물이 참인지의 문제**다. 첨부2 §3 9번과 §5 ①이
 *    심사자에게 *"자기 약관을 올려 보라"* 고 적는다. 누를 곳이 글자처럼 보이면
 *    그 절차가 화면에서 성립하지 않는다.
 *
 * ⚠ 이 검사는 **CSS 원문**을 본다. 실제 렌더는 브라우저가 하므로 여기서 못 잰다 —
 *   규칙이 사라지는 것만 잡는다. 시각 확인은 사람이 배포본에서 한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

/** `.uploadRow input[type=file]::file-selector-button{...}` 의 본문 */
function fileButtonRule(): string {
  const at = CSS.indexOf("input[type=file]::file-selector-button");
  expect(at, "::file-selector-button 규칙이 사라졌다 — 파일 선택이 글자로 보인다").toBeGreaterThan(-1);
  return CSS.slice(CSS.indexOf("{", at) + 1, CSS.indexOf("}", at));
}

describe("파일 선택 — 버튼으로 보여야 한다", () => {
  it("테두리·배경·여백을 모두 준다", () => {
    const rule = fileButtonRule();
    // 셋 중 하나만 빠져도 «글자» 로 돌아간다
    expect(rule, "테두리가 없다").toMatch(/border:[^;]*solid/);
    expect(rule, "배경이 없다").toMatch(/background:\s*var\(--/);
    expect(rule, "여백이 없다").toMatch(/padding:\s*\d/);
  });

  it("누를 수 있다는 것을 커서로도 말한다", () => {
    expect(fileButtonRule(), "cursor:pointer 가 없다").toContain("cursor:pointer");
  });

  it("글자색이 --ink3(흐린 회색)이 아니다 — 그게 «텍스트로 보이던» 값이다", () => {
    const color = /color:\s*var\((--[a-z0-9-]+)\)/.exec(fileButtonRule())?.[1];
    expect(color, "글자색을 안 정했다").toBeTruthy();
    expect(color, "--ink3 은 배포본에서 텍스트처럼 보이던 그 값이다").not.toBe("--ink3");
  });
});
