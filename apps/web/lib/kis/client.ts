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

function buildUrl(baseUrl: string, path: string, params: Record<string, string>) {
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
  attempt = 1,
): Promise<unknown> {
  const response = await fetch(url, { method: "GET", headers });
  const data = await parseJson(response);

  if (response.ok && !isKisRateLimit(data)) {
    return data;
  }

  if (attempt < 3 && (response.status === 429 || isKisRateLimit(data))) {
    await backoffKisRateLimit(attempt);
    return fetchJson(url, headers, attempt + 1);
  }

  throw new KisGuardError(`KIS request failed: ${response.status}`);
}

export async function kisGet(options: KisGetOptions) {
  const config = options.config ?? getKisAuthConfig();
  const target = getKisRequestTarget(options.purpose, config.env);
  const token = await getKisAccessToken(config);
  const url = buildUrl(target.baseUrl, options.path, options.params);

  return enqueueKisCall(() =>
    fetchJson(url, {
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
      authorization: `${token.tokenType} ${token.accessToken}`,
      appkey: config.appKey,
      appsecret: config.appSecret,
      tr_id: target.trId,
      custtype: "P",
    }),
  );
}
