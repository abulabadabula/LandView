import type { Provenance } from "@/types";
import { needsConfirmation, provenanceSummary } from "@/lib/provenance";
import { cn } from "@/lib/utils";

/** One-line data-source note. Assumed values are amber so they cannot be mistaken for measurements. */
export function ProvenanceNote({ provenance }: { provenance?: Provenance | null }) {
  if (!provenance) return null;
  const assumed = needsConfirmation(provenance);
  return (
    <p
      className={cn("mt-1 text-xs", assumed ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
      title={provenance.note ?? undefined}
    >
      {provenanceSummary(provenance)}
      {assumed && " (needs confirmation)"}
    </p>
  );
}
