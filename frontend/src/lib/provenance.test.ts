import { describe, expect, it } from "vitest";
import { countByStatus, needsConfirmation, provenanceSummary } from "./provenance";

describe("provenance helpers", () => {
  it("flags only ASSUMED as needing confirmation", () => {
    expect(needsConfirmation({ status: "ASSUMED", source: "x" })).toBe(true);
    expect(needsConfirmation({ status: "USER_CONFIRMED", source: "x" })).toBe(false);
    expect(needsConfirmation(undefined)).toBe(false);
  });
  it("summarises with optional date and version", () => {
    expect(provenanceSummary({ status: "DERIVED", source: "LINZ DEM", capturedAt: "2024-06-01", version: "2" })).toBe(
      "Derived · LINZ DEM · 2024-06-01 · v2",
    );
  });
  it("counts by status", () => {
    const c = countByStatus([
      { heightProvenance: { status: "ASSUMED", source: "a" } },
      { heightProvenance: { status: "ASSUMED", source: "a" } },
      { heightProvenance: { status: "DERIVED", source: "b" } },
      {},
    ]);
    expect(c).toMatchObject({ ASSUMED: 2, DERIVED: 1, MEASURED: 0 });
  });
});
