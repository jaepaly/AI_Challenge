import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { KisGuardError } from "./guard";

export const KIS_PROXY_AUTH_HEADER = "x-marginguard-kis-proxy-token";

let localProxyEnvCache: Record<string, string> | null = null;

function parseEnvFile(content: string) {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.split("#")[0].trim();
    }

    values[key] = value;
  }

  return values;
}

function readLocalProxyEnv() {
  if (localProxyEnvCache) {
    return localProxyEnvCache;
  }

  const localEnv: Record<string, string> = {};
  const candidates = new Set([
    resolve(process.cwd(), "..", "..", ".env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local"),
  ]);

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      Object.assign(localEnv, parseEnvFile(readFileSync(envPath, "utf8")));
    }
  }

  localProxyEnvCache = localEnv;
  return localProxyEnvCache;
}

function readExpectedToken(source: NodeJS.ProcessEnv) {
  const token = source.KIS_PROXY_TOKEN?.trim();
  if (token || source !== process.env) {
    return token ?? "";
  }

  return readLocalProxyEnv().KIS_PROXY_TOKEN?.trim() ?? "";
}

function readPresentedToken(request: Request) {
  const headerToken = request.headers.get(KIS_PROXY_AUTH_HEADER)?.trim();
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() ?? "";
}

function timingSafeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertKisAccountProxyAuthorized(
  request: Request,
  source = process.env,
) {
  const expected = readExpectedToken(source);
  if (!expected) {
    throw new KisGuardError(
      "KIS account proxy is disabled: KIS_PROXY_TOKEN is required.",
      503,
    );
  }

  const presented = readPresentedToken(request);
  if (!presented || !timingSafeStringEqual(presented, expected)) {
    throw new KisGuardError("KIS proxy authorization required.", 401);
  }
}
