import { describe, expect, it } from "vitest";
import {
  INGEST_DEGRADE_CACHE_SECONDS,
  INGEST_UPLOAD_REFERENCE_MESSAGE,
  readIngestUploadFaultInjection,
} from "./upload-fault";

describe("readIngestUploadFaultInjection", () => {
  it("is off by default", () => {
    expect(readIngestUploadFaultInjection({})).toBeNull();
    expect(readIngestUploadFaultInjection({ INGEST_UPLOAD_FAULT: "off" })).toBeNull();
  });

  it("injects spend-limit reference mode for budget-guard rehearsal", () => {
    expect(readIngestUploadFaultInjection({ INGEST_UPLOAD_FAULT: "spend_limit" })).toEqual({
      fault: "spend_limit",
      mode: "reference",
      retryAfterSeconds: INGEST_DEGRADE_CACHE_SECONDS,
      userMessage: INGEST_UPLOAD_REFERENCE_MESSAGE,
    });
  });

  it("supports rate-limit and upstream-error rehearsal modes", () => {
    expect(readIngestUploadFaultInjection({ INGEST_UPLOAD_FAULT: "429" })?.fault).toBe(
      "rate_limit",
    );
    expect(readIngestUploadFaultInjection({ INGEST_UPLOAD_FAULT: "500" })?.fault).toBe(
      "upstream_error",
    );
  });
});
