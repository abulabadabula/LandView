import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAppDispatch, useAppSelector } from "@/store";
import { clearResults, loadLot, searchAddresses } from "@/store/lotSlice";

export default function AddressSearch() {
  const dispatch = useAppDispatch();
  const { results, searching } = useAppSelector((s) => s.lot);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 4) { dispatch(clearResults()); return; }
    const t = setTimeout(() => dispatch(searchAddresses(q.trim())), 350);
    return () => clearTimeout(t);
  }, [q, dispatch]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    setQ(r.fullAddress);
    setOpen(false);
    dispatch(loadLot(r));
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      {searching ? (
        <Loader2 className="absolute left-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
      ) : (
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      )}
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter") pick(0); }}
        placeholder="Search a New Zealand address, e.g. 1 Queen Street Auckland"
        className="pl-8"
        aria-label="Search address"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.map((r, i) => (
            <li key={r.id}>
              <button className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => pick(i)}>
                {r.fullAddress}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
