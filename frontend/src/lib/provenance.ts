import type { Provenance, ProvenanceStatus } from "@/types";

export const STATUS_LABEL: Record<ProvenanceStatus, string> = {
  MEASURED: "Measured",
  DERIVED: "Derived",
  ASSUMED: "Assumed",
  USER_CONFIRMED: "Confirmed",
};

/** Assumed values must be visually flagged and confirmed by a person before they are relied on. */
export function needsConfirmation(p: Provenance | null | undefined): boolean {
  return p?.status === "ASSUMED";
}

export function provenanceSummary(p: Provenance): string {
  const parts = [STATUS_LABEL[p.status], p.source];
  if (p.capturedAt) parts.push(p.capturedAt);
  if (p.version) parts.push(`v${p.version}`);
  return parts.join(" · ");
}

/** Count items per provenance status, e.g. to summarise building heights. */
export function countByStatus(items: { heightProvenance?: Provenance }[]): Record<ProvenanceStatus, number> {
  const out: Record<ProvenanceStatus, number> = { MEASURED: 0, DERIVED: 0, ASSUMED: 0, USER_CONFIRMED: 0 };
  for (const i of items) if (i.heightProvenance) out[i.heightProvenance.status] += 1;
  return out;
}
