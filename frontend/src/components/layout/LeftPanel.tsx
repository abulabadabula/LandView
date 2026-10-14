import { useAppSelector } from "@/store";
import { compass } from "@/lib/geo";
import { ProvenanceNote } from "./ProvenanceNote";

const fmt = (n: number, d = 0) => n.toLocaleString("en-NZ", { maximumFractionDigits: d, minimumFractionDigits: d });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}

export default function LeftPanel() {
  const { selected, parcel, env, terrain, status } = useAppSelector((s) => s.lot);

  if (!selected) {
    return <div className="p-4 text-sm text-muted-foreground">Search for an address to see its lot details, boundary, topography and environment.</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Address">
        <p className="text-sm">{selected.fullAddress}</p>
        {status === "loading" && <p className="mt-1 text-xs text-muted-foreground">Loading…</p>}
      </Section>

      <Section title="Lot">
        {parcel ? (
          <>
            <Row label="Legal description" value={parcel.appellation} />
            <Row label="Title" value={parcel.titles} />
            <Row label="Intent" value={parcel.parcelIntent} />
            <Row label="Land district" value={parcel.landDistrict} />
            <Row label="Area" value={`${fmt(parcel.areaM2)} m² (${fmt(parcel.areaM2 / 10000, 4)} ha)`} />
          </>
        ) : status === "ready" ? (
          <p className="text-sm text-muted-foreground">No parcel found at this location.</p>
        ) : null}
      </Section>

      {parcel && (
        <Section title={`Boundary points (${parcel.boundary.length})`}>
          <div className="max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-secondary text-left">
                <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Lat / Lon</th><th className="px-2 py-1">NZTM E / N</th></tr>
              </thead>
              <tbody>
                {parcel.boundary.map((p) => (
                  <tr key={p.index} className="border-t">
                    <td className="px-2 py-1">{p.index}</td>
                    <td className="px-2 py-1">{p.lat.toFixed(6)}, {p.lon.toFixed(6)}</td>
                    <td className="px-2 py-1">{fmt(p.nztmE, 1)}, {fmt(p.nztmN, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {env && (
        <>
          <Section title="Topography">
            <Row label="Elevation" value={`${fmt(env.topography.elevationM, 1)} m`} />
            <Row label="Slope" value={`${fmt(env.topography.slopeDeg, 1)}°`} />
            <Row label="Aspect" value={compass(env.topography.aspectDeg)} />
            <ProvenanceNote provenance={env.topography.provenance} />
            {terrain && <Row label="Surrounding range" value={`${fmt(terrain.minElevation)}–${fmt(terrain.maxElevation)} m`} />}
          </Section>
          <Section title="Environment">
            <Row label="Wind zone (indicative)" value={env.wind.zone} />
            <Row label="Max gust (5 yr)" value={`${fmt(env.wind.maxGustMs, 1)} m/s`} />
            <Row label="Mean temperature" value={`${fmt(env.climate.meanTempC, 1)} °C`} />
            <Row label="Annual rainfall" value={`${fmt(env.climate.annualRainMm)} mm`} />
            <ProvenanceNote provenance={env.wind.provenance} />
            <p className="mt-2 text-xs text-muted-foreground">{env.wind.disclaimer}</p>
          </Section>
        </>
      )}
    </div>
  );
}
