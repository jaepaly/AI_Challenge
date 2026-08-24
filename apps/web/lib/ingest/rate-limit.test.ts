import { beforeEach, describe, expect, it } from "vitest";
import {
  clientKeyFrom,
  takeUploadSlot,
  __resetUploadQuotaForTests,
  PER_CLIENT_LIMIT,
  GLOBAL_LIMIT,
  WINDOW_MS,
} from "./rate-limit";

/**
 * 업로드 쿼터가 **실제로 막는지** 본다.
 *
 * 이 검사가 지키는 것은 비용이다 — 업로드 1건이 약 416원이고 심사 기간에 URL 이
 * 인증 없이 공개된다. 다만 **절대 상한은 Console spend limit** 이라는 것도 함께
 * 고정한다(아래 마지막 검사) — 여기 숫자를 절대 방어선으로 읽으면 안 된다.
 */
describe("업로드 쿼터", () => {
  beforeEach(() => __resetUploadQuotaForTests());

  it("IP 하나는 한도까지 통과하고 그 다음부터 막힌다", () => {
    const now = 1_000_000;
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) {
      expect(takeUploadSlot("1.2.3.4", now).allowed, `${i + 1}번째`).toBe(true);
    }
    const blocked = takeUploadSlot("1.2.3.4", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("client");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("창이 지나면 다시 열린다", () => {
    const now = 1_000_000;
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) takeUploadSlot("1.2.3.4", now);
    expect(takeUploadSlot("1.2.3.4", now).allowed).toBe(false);
    expect(takeUploadSlot("1.2.3.4", now + WINDOW_MS + 1).allowed).toBe(true);
  });

  it("IP 를 바꿔도 전역 한도에서 막힌다 — **이쪽이 실제 상한이다**", () => {
    const now = 1_000_000;
    let allowed = 0;
    // IP 마다 새 키라 IP 축은 절대 안 걸린다. 그런데도 멈춰야 한다.
    for (let i = 0; i < GLOBAL_LIMIT + 5; i++) {
      if (takeUploadSlot(`10.0.0.${i}`, now).allowed) allowed++;
    }
    expect(allowed).toBe(GLOBAL_LIMIT);
    expect(takeUploadSlot("10.0.99.1", now).scope).toBe("global");
  });

  it("막힌 요청은 카운트를 올리지 않는다 — 막을수록 더 오래 막히면 안 된다", () => {
    const now = 1_000_000;
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) takeUploadSlot("1.2.3.4", now);
    const first = takeUploadSlot("1.2.3.4", now).retryAfterSeconds!;
    for (let i = 0; i < 20; i++) takeUploadSlot("1.2.3.4", now);
    expect(takeUploadSlot("1.2.3.4", now).retryAfterSeconds).toBe(first);
  });

  it("전역 한도가 IP 한도보다 커야 의미가 있다", () => {
    // 반대면 IP 축이 영영 발화하지 않아, 검사가 있다는 사실이 오해를 만든다.
    expect(GLOBAL_LIMIT).toBeGreaterThan(PER_CLIENT_LIMIT);
  });
});

describe("클라이언트 키", () => {
  const key = (init: Record<string, string>) => clientKeyFrom(new Headers(init));

  it("x-forwarded-for 의 첫 항목을 쓴다", () => {
    expect(key({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
  });

  it("없으면 x-real-ip 로 내려간다", () => {
    expect(key({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("아무것도 없으면 하나의 공용 키로 묶는다 — 모르는 것을 관대하게 다루지 않는다", () => {
    expect(key({})).toBe("unknown");
    // 같은 키로 묶이므로 그 무리 전체가 IP 축 한도를 나눠 쓴다
    __resetUploadQuotaForTests();
    for (let i = 0; i < PER_CLIENT_LIMIT; i++) takeUploadSlot("unknown", 1);
    expect(takeUploadSlot("unknown", 1).allowed).toBe(false);
  });
});
