import { describe, expect, it, vi } from "vitest";
import { checkAnthropicModelsHealth } from "./anthropic-health";

describe("checkAnthropicModelsHealth", () => {
  it("does not call Anthropic when ANTHROPIC_API_KEY is missing", async () => {
    const fetcher = vi.fn();

    await expect(
      checkAnthropicModelsHealth({ apiKey: "", fetcher }),
    ).resolves.toEqual({ ok: false, status: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only ok and upstream status for a valid models response", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(
      checkAnthropicModelsHealth({ apiKey: "sk-ant-test", fetcher }),
    ).resolves.toEqual({ ok: true, status: 200 });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-test",
        }),
        cache: "no-store",
      }),
    );
  });

  it("does not expose upstream error bodies", async () => {
    const fetcher = vi.fn(
      async () => new Response("invalid api key body", { status: 401 }),
    );

    await expect(
      checkAnthropicModelsHealth({ apiKey: "bad-key", fetcher }),
    ).resolves.toEqual({ ok: false, status: 401 });
  });

  it("normalizes network failures to status 0", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network detail that must not leak");
    });

    await expect(
      checkAnthropicModelsHealth({ apiKey: "sk-ant-test", fetcher }),
    ).resolves.toEqual({ ok: false, status: 0 });
  });
});
