import "server-only";

import type { KisTrPurpose } from "./guard";
import type { KisAuthConfig } from "./config";
import { getKisAuthConfig } from "./config";
import { getKisRequestTarget, KisGuardError } from "./guard";
import { backoffKisRateLimit, enqueueKisCall } from "./rate-limit";
import { getKisAccessToken } from "./token";

interface KisGetOptions {
  purpose: KisTrPurpose;
  path: string;
  params: Record<string, string>;
  config?: KisAuthConfig;
}

const KIS_FETCH_TIMEOUT_MS = 5_000;
const KIS_REQUEST_BUDGET_MS = 8_000;

function combinedSignal(requestDeadline: AbortSignal) {
  return AbortSignal.any([
    AbortSignal.timeout(KIS_FETCH_TIMEOUT_MS),
    requestDeadline,
  ]);
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function isKisRateLimit(data: unknown) {
  return (
    typeof data === "object" &&
    data !== null &&
    "msg_cd" in data &&
    String((data as { msg_cd: unknown }).msg_cd) === "EGW00201"
  );
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KisGuardError("KIS response was not valid JSON.");
  }
}

async function fetchJson(
  url: URL,
  headers: HeadersInit,
  requestDeadline: AbortSignal,
  attempt = 1,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: combinedSignal(requestDeadline),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new KisGuardError("KIS upstream request timed out.", 504);
    }
    throw error;
  }
  const data = await parseJson(response);

  if (response.ok && !isKisRateLimit(data)) {
    return data;
  }

  if (attempt < 3 && (response.status === 429 || isKisRateLimit(data))) {
    await backoffKisRateLimit(attempt, requestDeadline);
    return fetchJson(url, headers, requestDeadline, attempt + 1);
  }

  // KIS는 레이트리밋을 **HTTP 200 + msg_cd EGW00201**로 준다. response.status를
  // 그대로 인용하면 "KIS request failed: 200"이라는 뜻 없는 문구가 되고,
  // KisGuardError 기본값이 400이라 클라이언트는 "네 요청이 잘못됐다"로 읽는다.
  // 실제는 "상류가 조르고 있으니 잠시 뒤 다시"다 — 화면이 재시도 불가와
  // 잠시 후 재시도를 구분해야 하는 지점이라 429로 분리한다(#39 리뷰).
  if (isKisRateLimit(data) || response.status === 429) {
    throw new KisGuardError(
      "KIS upstream is rate limiting; retry shortly.",
      429,
    );
  }
  throw new KisGuardError(`KIS request failed: ${response.status}`);
}

export async function kisGet(options: KisGetOptions) {
  const requestDeadline = AbortSignal.timeout(KIS_REQUEST_BUDGET_MS);
  const config = options.config ?? getKisAuthConfig();
  const target = getKisRequestTarget(options.purpose, config.env);
  const token = await getKisAccessToken(config, requestDeadline);
  const url = buildUrl(target.baseUrl, options.path, options.params);

  return enqueueKisCall(
    () =>
      fetchJson(
        url,
        {
          "content-type": "application/json; charset=utf-8",
          accept: "application/json",
          authorization: `${token.tokenType} ${token.accessToken}`,
          appkey: config.appKey,
          appsecret: config.appSecret,
          tr_id: target.trId,
          custtype: "P",
        },
        requestDeadline,
      ),
    requestDeadline,
  );
}
