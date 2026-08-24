import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, MAX_UPLOAD_BYTES } from "./route";
import { __resetUploadQuotaForTests, PER_CLIENT_LIMIT } from "@/lib/ingest/rate-limit";

/**
 * 업로드 프록시 — **화면이 무엇을 약속하는가**를 고정한다.
 *
 * 이 라우트는 추론을 하지 않는다. 그래서 여기서 볼 것은 계산이 아니라 **거절의 모양**
 * 이다: 붙어 있지 않을 때 / 상류가 죽었을 때 / 한도에 걸렸을 때 화면이 무엇을 듣는가.
 *
 * `#79` 까지의 규율을 그대로 잇는다 — **없는 기능을 있는 척하지 않는다.**
 * `INGEST_BASE_URL` 이 없으면 500 이 아니라 **503 + 대안 문장**이다. 사전 계산된
 * 카드로 계속 쓸 수 있다는 것이 사실이고, 그 사실을 말해야 한다.
 */

const BASE = "https://ingest.example.test";

function upload(name: string, bytes = 1024, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name), name);
  return new Request("https://x.test/api/ingest", { method: "POST", body: form, headers });
}

beforeEach(() => {
  __resetUploadQuotaForTests();
  process.env.INGEST_BASE_URL = BASE;
  delete process.env.INGEST_UPLOAD_FAULT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INGEST_BASE_URL;
  delete process.env.INGEST_UPLOAD_FAULT;
});

describe("연결돼 있지 않을 때", () => {
  it("503 이고, 대안이 있다고 말한다", async () => {
    delete process.env.INGEST_BASE_URL;
    const response = await POST(upload("a.pdf"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.detail).toContain("사전 계산된 조건카드");
  });
});

describe("강등 주입", () => {
  it("참고 모드로 내려가고 Retry-After 를 준다", async () => {
    process.env.INGEST_UPLOAD_FAULT = "spend_limit";
    const response = await POST(upload("a.pdf"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    const body = await response.json();
    expect(body.mode).toBe("reference");
    expect(body.fault).toBe("spend_limit");
  });

  it("공개 요청이 강제할 수 없다 — env 로만 켜진다", async () => {
    // ⚠ fetch 를 반드시 막는다. 안 막으면 이 검사가 **실제 DNS 를 친다** — CI 에서
    //   지연에 흔들리고, 무엇보다 검사가 네트워크에 의존하게 된다.
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const response = await POST(
      upload("a.pdf", 1024, { "x-ingest-upload-fault": "spend_limit" }),
    );
    // 헤더로는 안 켜지므로 그대로 상류로 나간다
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("입력 거절", () => {
  it("파일이 없으면 400", async () => {
    const response = await POST(
      new Request("https://x.test/api/ingest", { method: "POST", body: new FormData() }),
    );
    expect(response.status).toBe(400);
  });

  it("확장자가 다르면 415 — 무엇을 받는지 함께 말한다", async () => {
    const response = await POST(upload("cat.png"));
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.allowed).toEqual([".pdf", ".htm", ".html"]);
  });

  it("Vercel 본문 한도(4.5MB)에 걸리기 전에 우리가 413 을 낸다", async () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    const response = await POST(upload("big.pdf", MAX_UPLOAD_BYTES + 1));
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.limitBytes).toBe(MAX_UPLOAD_BYTES);
  });
});

describe("쿼터", () => {
  it("한도를 넘으면 429 + Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const ip = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) {
      expect((await POST(upload("a.pdf", 1024, ip))).status).toBe(200);
    }
    const blocked = await POST(upload("a.pdf", 1024, ip));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("⚠ 쿼터를 형식 검사보다 **먼저** 본다 — 거절도 슬롯을 쓴다", async () => {
    // 형식 검사를 먼저 두면 잘못된 파일을 무한히 던져 상류를 재촉할 수 있다.
    const ip = { "x-forwarded-for": "203.0.113.6" };
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) await POST(upload("cat.png", 1024, ip));
    expect((await POST(upload("a.pdf", 1024, ip))).status).toBe(429);
  });
});

describe("상류로 넘길 때", () => {
  it("텔레메트리 헤더를 그대로 통과시킨다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, status: "draft" }), {
            status: 200,
            headers: { "X-Ingest-Total-Ms": "68136.9", "X-Other": "drop" },
          }),
      ),
    );
    const response = await POST(upload("a.pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ingest-Total-Ms")).toBe("68136.9");
    expect(response.headers.get("X-Other")).toBeNull();
  });

  it("상류 오류 코드를 삼키지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "거부" }), { status: 422 })),
    );
    expect((await POST(upload("a.pdf"))).status).toBe(422);
  });

  it("닿지 못하면 502 이고, 대안이 있다고 말한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const response = await POST(upload("a.pdf"));
    expect(response.status).toBe(502);
    expect((await response.json()).detail).toContain("사전 계산된 조건카드");
  });

  it("시간 안에 안 끝나면 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }),
    );
    expect((await POST(upload("a.pdf"))).status).toBe(504);
  });

  it("경로 끝의 슬래시가 겹치지 않는다", async () => {
    // 인자를 선언해야 `mock.calls[0][0]` 이 타입으로 잡힌다 — 빈 목은 인자 튜플이
    // `[]` 로 추론돼 `next build` 의 타입체크가 TS2493 으로 넘어진다.
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    process.env.INGEST_BASE_URL = `${BASE}///`;
    await POST(upload("a.pdf"));
    expect(spy.mock.calls[0]![0]).toBe(`${BASE}/ingest`);
  });
});
