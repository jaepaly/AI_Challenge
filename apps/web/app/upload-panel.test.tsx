// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import UploadPanel from "./upload-panel";

/**
 * 업로드 패널이 **약속하는 것**을 고정한다.
 *
 * 이 화면은 심사위원이 자기 문서를 올리는 자리다. 그래서 여기 적힌 문장은 *"기능이
 * 어떻게 동작하는지"* 보다 *"우리가 그 파일로 무엇을 하는지"* 가 더 중요하다 —
 * 틀리면 기능 결함이 아니라 **거짓말**이 된다.
 *
 * `#63`(배너가 "쓰지 않는다"면서 그 카드로 계산) · `#66`(그 문구의 사본) · `#74`
 * (가진 적 없는 판본을 출처로) 가 전부 같은 종류였다. 이 파일이 그 자리를 미리 막는다.
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

function pick(file = new File([new Uint8Array(8)], "a.pdf")) {
  const input = document.querySelector<HTMLInputElement>("#uploadFile")!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  // ⚠ **반드시 지운다.** 안 지우면 렌더가 문서에 쌓이고 `document.querySelector` 가
  //   앞선 테스트의 입력을 잡는다 — 그러면 이 파일의 검사가 **다른 컴포넌트 인스턴스**를
  //   보게 된다(실제로 그래서 성공 경로 검사 하나가 빨간불이었다).
  cleanup();
  vi.unstubAllGlobals();
});

describe("파일로 무엇을 하는지 말한다", () => {
  it("저장하지 않는다는 것과 **전송된다**는 것을 함께 적는다", () => {
    const { container } = render(<UploadPanel onCard={() => {}} />);
    const note = container.querySelector(".uploadNote")!.textContent!;
    // 우리 저장소만 말하고 전송을 빼면 절반만 말하는 것이 된다
    expect(note).toMatch(/저장하지 않습니다/);
    expect(note).toMatch(/Anthropic/);
    expect(note).toMatch(/전송/);
  });

  it("계산이 엔진 몫이라는 것을 적는다 — 이 제품의 핵심 주장이다", () => {
    const { container } = render(<UploadPanel onCard={() => {}} />);
    expect(container.textContent).toMatch(/엔진/);
    expect(container.textContent).toMatch(/모델이 만들지 않습니다/);
  });
});

describe("실패했을 때", () => {
  it("서버가 준 이유를 그대로 낸다 — 우리가 다시 쓰지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "업로드가 이 배포본에 연결돼 있지 않습니다",
              detail: "사전 계산된 조건카드로 계속 사용할 수 있습니다",
            }),
            { status: 503 },
          ),
      ),
    );
    render(<UploadPanel onCard={() => {}} />);
    pick();
    await waitFor(() => {
      const status = document.querySelector("#uploadStatus")!.textContent!;
      expect(status).toContain("연결돼 있지 않습니다");
      // 대안이 있다는 사실도 삼키지 않는다
      expect(status).toContain("사전 계산된 조건카드");
    });
  });

  it("본문이 JSON 이 아니어도 상태 코드로 말한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    render(<UploadPanel onCard={() => {}} />);
    pick();
    await waitFor(() => {
      expect(document.querySelector("#uploadStatus")!.textContent).toContain("502");
    });
  });
});

describe("성공했을 때", () => {
  it("카드를 넘기고 **검수 전**이라고 말한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CARD), { status: 200 })));
    const seen: unknown[] = [];
    render(<UploadPanel onCard={(preset) => seen.push(preset)} />);
    pick();
    await waitFor(() => {
      expect(seen).toHaveLength(1);
      expect(document.querySelector("#uploadStatus")!.textContent).toContain("검수 전");
    });
  });

  it("성공 문구가 검증을 주장하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CARD), { status: 200 })));
    render(<UploadPanel onCard={() => {}} />);
    pick();
    await waitFor(() => {
      const status = document.querySelector("#uploadStatus")!.textContent!;
      for (const claim of ["검증됨", "확인됨", "정식"]) {
        expect(status, `"${claim}" 을 쓰면 안 된다`).not.toContain(claim);
      }
    });
  });
});

describe("기다리는 동안", () => {
  it("경과 초와 **실측 기준**을 함께 낸다 — 남은 시간을 지어내지 않는다", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    render(<UploadPanel onCard={() => {}} />);
    pick();
    await waitFor(() => {
      const status = document.querySelector("#uploadStatus")!.textContent!;
      expect(status).toMatch(/경과/);
      expect(status).toMatch(/68초/);
      // "남은 시간 N초" 같은 예측은 하지 않는다 — 서버가 진행률을 안 준다
      expect(status).not.toMatch(/남은/);
    });
    release(new Response(JSON.stringify(CARD), { status: 200 }));
  });

  it("분석 중에는 입력을 잠근다 — 두 번 눌러 두 번 과금되지 않게", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<UploadPanel onCard={() => {}} />);
    pick();
    await waitFor(() => {
      expect(document.querySelector<HTMLInputElement>("#uploadFile")!.disabled).toBe(true);
    });
    expect(screen.getByText("분석 중…")).toBeTruthy();
  });
});
