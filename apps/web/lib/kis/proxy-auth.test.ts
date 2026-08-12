import { describe, expect, it } from "vitest";

import { KisGuardError } from "./guard";
import {
  KIS_PROXY_AUTH_HEADER,
  assertKisAccountProxyAuthorized,
} from "./proxy-auth";

function requestWithHeaders(headers: HeadersInit) {
  return new Request("https://example.test/api/kis/balance", { headers });
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

function catchKisGuardError(fn: () => void) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KisGuardError);
    return error as KisGuardError;
  }

  throw new Error("Expected KisGuardError.");
}

describe("KIS account proxy auth", () => {
  it("accepts the configured header token", () => {
    expect(() =>
      assertKisAccountProxyAuthorized(
        requestWithHeaders({ [KIS_PROXY_AUTH_HEADER]: "secret-token" }),
        env({ KIS_PROXY_TOKEN: "secret-token" }),
      ),
    ).not.toThrow();
  });

  it("accepts a bearer token", () => {
    expect(() =>
      assertKisAccountProxyAuthorized(
        requestWithHeaders({ authorization: "Bearer secret-token" }),
        env({ KIS_PROXY_TOKEN: "secret-token" }),
      ),
    ).not.toThrow();
  });

  it("rejects missing configuration and bad tokens", () => {
    const missingConfig = catchKisGuardError(() =>
      assertKisAccountProxyAuthorized(requestWithHeaders({}), env({})),
    );
    expect(missingConfig).toMatchObject({ status: 503 });

    expect(() =>
      assertKisAccountProxyAuthorized(
        requestWithHeaders({ [KIS_PROXY_AUTH_HEADER]: "wrong" }),
        env({ KIS_PROXY_TOKEN: "secret-token" }),
      ),
    ).toThrow(KisGuardError);

    const badToken = catchKisGuardError(() =>
      assertKisAccountProxyAuthorized(
        requestWithHeaders({ [KIS_PROXY_AUTH_HEADER]: "wrong" }),
        env({ KIS_PROXY_TOKEN: "secret-token" }),
      ),
    );
    expect(badToken).toMatchObject({ status: 401 });
  });
});
