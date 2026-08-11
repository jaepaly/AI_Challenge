export type IngestUploadFault =
  | "spend_limit"
  | "rate_limit"
  | "upstream_error";

export interface IngestUploadFaultState {
  fault: IngestUploadFault;
  mode: "reference";
  retryAfterSeconds: number;
  userMessage: string;
}

type EnvSource = Record<string, string | undefined>;

export const INGEST_UPLOAD_FAULT_ENV = "INGEST_UPLOAD_FAULT";
export const INGEST_DEGRADE_CACHE_SECONDS = 5 * 60;
export const INGEST_UPLOAD_REFERENCE_MESSAGE =
  "업로드 일시 중단, 사전 계산 카드로 계속 가능";

/**
 * Test hook for the future upload route. Keep it env-only so a public request
 * cannot force the production service into reference mode.
 */
export function readIngestUploadFaultInjection(
  source: EnvSource = process.env,
): IngestUploadFaultState | null {
  const raw = source[INGEST_UPLOAD_FAULT_ENV]?.trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") return null;

  const fault: IngestUploadFault =
    raw === "rate_limit" || raw === "429"
      ? "rate_limit"
      : raw === "upstream_error" || raw === "500"
        ? "upstream_error"
        : "spend_limit";

  return {
    fault,
    mode: "reference",
    retryAfterSeconds: INGEST_DEGRADE_CACHE_SECONDS,
    userMessage: INGEST_UPLOAD_REFERENCE_MESSAGE,
  };
}
