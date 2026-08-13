import "server-only";

import type { KisAuthConfig } from "./config";
import { getKisAuthConfig } from "./config";
import { KisGuardError } from "./guard";
import { enqueueKisCall } from "./rate-limit";

interface KisTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  access_token_token_expired?: string;
}

interface KisTokenCache {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
}

let tokenCache: KisTokenCache | null = null;
let tokenPromise: Promise<KisTokenCache> | null = null;

const KIS_TOKEN_FETCH_TIMEOUT_MS = 5_000;

function tokenSignal(requestDeadline?: AbortSignal) {
  const attemptSignal = AbortSignal.timeout(KIS_TOKEN_FETCH_TIMEOUT_MS);
  return requestDeadline
    ? AbortSignal.any([attemptSignal, requestDeadline])
    : attemptSignal;
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isUsableToken(cache: KisTokenCache | null): cache is KisTokenCache {
  return cache !== null && cache.expiresAt - Date.now() > 60_000;
}

function parseExpiresAt(data: KisTokenResponse) {
  if (data.access_token_token_expired) {
    const parsed = Date.parse(data.access_token_token_expired);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now() + Math.max(0, data.expires_in ?? 86_400) * 1_000;
}

async function requestToken(
  config: KisAuthConfig,
  requestDeadline?: AbortSignal,
): Promise<KisTokenCache> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/oauth2/tokenP`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: config.appKey,
        appsecret: config.appSecret,
      }),
      signal: tokenSignal(requestDeadline),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new KisGuardError("KIS token request timed out.", 504);
    }
    throw error;
  }

  if (!response.ok) {
    throw new KisGuardError(`KIS token request failed: ${response.status}`);
  }

  const data = (await response.json()) as KisTokenResponse;
  if (!data.access_token) {
    throw new KisGuardError("KIS token response did not include access_token.");
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "Bearer",
    expiresAt: parseExpiresAt(data),
  };
}

export async function getKisAccessToken(
  config = getKisAuthConfig(),
  requestDeadline?: AbortSignal,
) {
  if (isUsableToken(tokenCache)) {
    return tokenCache;
  }

  tokenPromise ??= enqueueKisCall(() =>
    requestToken(config, requestDeadline),
  ).finally(() => {
    tokenPromise = null;
  });

  tokenCache = await tokenPromise;
  return tokenCache;
}
