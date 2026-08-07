import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KIS_BASE_URL_BY_ENV, KisGuardError, normalizeKisEnv } from "./guard";

export interface KisAuthConfig {
  env: "vps" | "prod";
  baseUrl: string;
  appKey: string;
  appSecret: string;
}

export interface KisAccountConfig extends KisAuthConfig {
  accountNo: string;
  cano: string;
  acntPrdtCd: string;
}

function requireEnv(source: NodeJS.ProcessEnv, key: string) {
  const value = getEnvValue(source, key);
  if (!value) {
    throw new KisGuardError(`${key} is required.`);
  }
  return value;
}

let localEnvCache: Record<string, string> | null = null;

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

function readLocalEnv() {
  if (localEnvCache) {
    return localEnvCache;
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

  localEnvCache = localEnv;
  return localEnvCache;
}

function getEnvValue(source: NodeJS.ProcessEnv, key: string) {
  return source[key]?.trim() || readLocalEnv()[key]?.trim();
}

function splitAccountNo(accountNo: string) {
  const match = accountNo.match(/^(\d{8})-?(\d{2})$/);
  if (!match) {
    throw new KisGuardError("KIS_ACCOUNT_NO must use the 8-2 format.");
  }

  return {
    cano: match[1],
    acntPrdtCd: match[2],
  };
}

export function getKisAuthConfig(source = process.env): KisAuthConfig {
  const env = normalizeKisEnv(source.KIS_ENV);

  return {
    env,
    baseUrl: KIS_BASE_URL_BY_ENV[env],
    appKey: requireEnv(source, "KIS_APP_KEY"),
    appSecret: requireEnv(source, "KIS_APP_SECRET"),
  };
}

export function getKisAccountConfig(source = process.env): KisAccountConfig {
  const auth = getKisAuthConfig(source);
  const accountNo = requireEnv(source, "KIS_ACCOUNT_NO");
  const { cano, acntPrdtCd } = splitAccountNo(accountNo);

  return {
    ...auth,
    accountNo,
    cano,
    acntPrdtCd,
  };
}
