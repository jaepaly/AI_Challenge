export class KisGuardError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "KisGuardError";
    this.status = status;
  }
}

export type KisEnv = "vps" | "prod";
export type KisTrCategory = "transactional" | "market_data";
export type KisTrPurpose = "balance" | "buyable" | "quote";

export interface KisTrIdEntry {
  purpose: KisTrPurpose;
  category: KisTrCategory;
  realTrId: string;
  mockTrId: string;
}

export const KIS_BASE_URL_BY_ENV = {
  vps: "https://openapivts.koreainvestment.com:29443",
  prod: "https://openapi.koreainvestment.com:9443",
} as const satisfies Record<KisEnv, string>;

export const KIS_TR_ID_REGISTRY = {
  balance: {
    purpose: "balance",
    category: "transactional",
    realTrId: "TTTC8434R",
    mockTrId: "VTTC8434R",
  },
  buyable: {
    purpose: "buyable",
    category: "transactional",
    realTrId: "TTTC8908R",
    mockTrId: "VTTC8908R",
  },
  quote: {
    purpose: "quote",
    category: "market_data",
    realTrId: "FHKST01010100",
    mockTrId: "FHKST01010100",
  },
} as const satisfies Record<KisTrPurpose, KisTrIdEntry>;

export function normalizeKisEnv(env: string | null | undefined): KisEnv {
  const normalized = env?.trim() || "vps";
  if (normalized === "vps" || normalized === "prod") {
    return normalized;
  }

  throw new KisGuardError(`Unsupported KIS_ENV: ${normalized}`);
}

function assertEntryAllowedForEnv(entry: KisTrIdEntry, env: KisEnv) {
  if (env === "prod" && entry.category === "transactional") {
    throw new KisGuardError(
      `Production KIS_ENV cannot call transactional TR_ID: ${entry.purpose}`,
    );
  }
}

function findRegisteredTrId(trId: string) {
  return Object.values(KIS_TR_ID_REGISTRY).find(
    (entry) => entry.realTrId === trId || entry.mockTrId === trId,
  );
}

export function resolveKisTrId(purpose: KisTrPurpose, envInput = "vps") {
  const env = normalizeKisEnv(envInput);
  const entry = KIS_TR_ID_REGISTRY[purpose];

  assertEntryAllowedForEnv(entry, env);
  return env === "vps" ? entry.mockTrId : entry.realTrId;
}

export function assertKisTrIdAllowed(trId: string, envInput = "vps") {
  const env = normalizeKisEnv(envInput);
  const normalizedTrId = trId.trim();
  const entry = findRegisteredTrId(normalizedTrId);

  if (!entry) {
    throw new KisGuardError(`Unregistered KIS TR_ID: ${normalizedTrId}`);
  }

  assertEntryAllowedForEnv(entry, env);

  const expectedTrId = env === "vps" ? entry.mockTrId : entry.realTrId;
  if (normalizedTrId !== expectedTrId) {
    throw new KisGuardError(
      `KIS TR_ID ${normalizedTrId} is not allowed for KIS_ENV=${env}.`,
    );
  }
}

export function getKisRequestTarget(purpose: KisTrPurpose, envInput = "vps") {
  const env = normalizeKisEnv(envInput);

  return {
    env,
    baseUrl: KIS_BASE_URL_BY_ENV[env],
    trId: resolveKisTrId(purpose, env),
  };
}
