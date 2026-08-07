import { describe, expect, it } from "vitest";
import {
  KIS_TR_ID_REGISTRY,
  KisGuardError,
  assertKisTrIdAllowed,
  getKisRequestTarget,
  resolveKisTrId,
} from "./guard";

describe("KIS TR_ID guard", () => {
  it("enforces the registered TR_ID policy by environment and category", () => {
    expect(resolveKisTrId("balance", "vps")).toBe("VTTC8434R");
    expect(resolveKisTrId("quote", "vps")).toBe("FHKST01010100");
    expect(resolveKisTrId("quote", "prod")).toBe("FHKST01010100");
    expect(getKisRequestTarget("quote", "prod")).toMatchObject({
      baseUrl: "https://openapi.koreainvestment.com:9443",
      trId: "FHKST01010100",
    });
    expect(() => assertKisTrIdAllowed("VTTC8434R", "vps")).not.toThrow();
    expect(() => assertKisTrIdAllowed("FHKST01010100", "vps")).not.toThrow();
    expect(() => assertKisTrIdAllowed("FHKST01010100", "prod")).not.toThrow();

    expect(() => assertKisTrIdAllowed("TTTC8434R", "vps")).toThrow(
      KisGuardError,
    );
    expect(() => assertKisTrIdAllowed("VTTC8434R", "prod")).toThrow(
      KisGuardError,
    );

    for (const entry of Object.values(KIS_TR_ID_REGISTRY)) {
      if (entry.category === "transactional") {
        expect(() => resolveKisTrId(entry.purpose, "prod")).toThrow(
          KisGuardError,
        );
      }
    }

    expect(() => assertKisTrIdAllowed("UNKNOWN_TR_ID", "vps")).toThrow(
      KisGuardError,
    );
    expect(() => assertKisTrIdAllowed("UNKNOWN_TR_ID", "prod")).toThrow(
      KisGuardError,
    );
  });
});
