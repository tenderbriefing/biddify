import { formatZar } from "@/lib/format";

type Candidate = {
  id: string;
  productName: string;
  brand: string | null;
  productUrl: string | null;
  price: unknown;
  priceKnown: boolean;
  evidenceLevel: string;
  matchVerdict: string;
  matchReasoning: string | null;
  selected: boolean;
  selectionStatus: string | null;
  selectionReason: string | null;
  sourceName: string;
  sourceQuality: number | null;
  vatTreatment: string | null;
  availability: string | null;
  packCalculationJson: string | null;
  deliveryJson: string | null;
  attributeComparisonsJson: string | null;
  researchProvider: string | null;
};

type Line = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: unknown;
  unit: string;
  brandRequirement: string | null;
  researchCandidates: Candidate[];
};

export function ProductResearchPanel({
  lines,
}: {
  lines: Line[];
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg-muted)]">
        Live / catalogue product research evidence. Founder review is optional —
        autonomous processing continues without interacting here.
      </p>
      {lines.map((line) => {
        const selected = line.researchCandidates.find((c) => c.selected);
        const alts = line.researchCandidates.filter(
          (c) => !c.selected && c.selectionStatus !== "REJECTED",
        );
        const rejected = line.researchCandidates.filter(
          (c) => c.selectionStatus === "REJECTED",
        );
        const attrs = selected?.attributeComparisonsJson
          ? (JSON.parse(selected.attributeComparisonsJson) as Array<{
              attribute: string;
              required: string | null;
              observed: string | null;
              result: string;
              source: string;
            }>)
          : [];
        const pack = selected?.packCalculationJson
          ? JSON.parse(selected.packCalculationJson)
          : null;
        const delivery = selected?.deliveryJson
          ? JSON.parse(selected.deliveryJson)
          : null;

        return (
          <section
            key={line.id}
            className="border border-[var(--border)] bg-white p-4"
          >
            <h3 className="text-sm font-semibold">
              Line {line.lineNumber}: {line.description}
            </h3>
            <div className="mt-1 text-xs text-[var(--fg-muted)]">
              Qty {String(line.quantity)} {line.unit}
              {line.brandRequirement ? ` · Brand: ${line.brandRequirement}` : ""}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  Selected candidate
                </h4>
                {selected ? (
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="font-medium">{selected.productName}</div>
                    <div>{selected.sourceName}</div>
                    <div>
                      Procurement price:{" "}
                      {selected.priceKnown
                        ? formatZar(Number(selected.price))
                        : "—"}
                    </div>
                    <div>Match: {selected.matchVerdict}</div>
                    <div>Evidence: {selected.evidenceLevel}</div>
                    <div>VAT: {selected.vatTreatment ?? "UNKNOWN"}</div>
                    <div>Availability: {selected.availability ?? "UNKNOWN"}</div>
                    <div>
                      Source quality:{" "}
                      {selected.sourceQuality?.toFixed(2) ?? "—"} · Provider:{" "}
                      {selected.researchProvider ?? "—"}
                    </div>
                    {selected.productUrl && (
                      <a
                        href={selected.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--accent)] underline"
                      >
                        Open source page
                      </a>
                    )}
                    {selected.matchReasoning && (
                      <p className="text-xs text-[var(--fg-muted)]">
                        {selected.matchReasoning}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--fg-muted)]">
                    No selected candidate
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  Specification comparison
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {attrs.length === 0 && (
                    <li className="text-[var(--fg-muted)]">No attribute rows</li>
                  )}
                  {attrs.map((a, i) => (
                    <li key={`${a.attribute}-${i}`}>
                      <span className="font-medium">{a.attribute}</span>:{" "}
                      {a.required ?? "—"} / {a.observed ?? "—"} / {a.result}
                    </li>
                  ))}
                </ul>
                {pack && (
                  <div className="mt-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                      Pack calculation
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap text-xs">
                      {pack.calculation ?? JSON.stringify(pack, null, 2)}
                    </pre>
                  </div>
                )}
                {delivery && (
                  <div className="mt-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                      Delivery
                    </div>
                    <div className="mt-1">
                      {delivery.type}
                      {delivery.known
                        ? ` · ${formatZar(Number(delivery.amount ?? 0))}`
                        : " · UNKNOWN (not R0)"}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  Price observations / alternatives
                </h4>
                <ul className="mt-2 space-y-2 text-sm">
                  {alts.length === 0 && (
                    <li className="text-[var(--fg-muted)]">None</li>
                  )}
                  {alts.map((c) => (
                    <li key={c.id} className="border-t border-[var(--border)] pt-2">
                      {c.productName} ·{" "}
                      {c.priceKnown ? formatZar(Number(c.price)) : "no price"} ·{" "}
                      {c.matchVerdict}
                      {c.productUrl && (
                        <>
                          {" "}
                          <a
                            href={c.productUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--accent)] underline"
                          >
                            link
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  Rejected
                </h4>
                <ul className="mt-2 space-y-2 text-sm">
                  {rejected.length === 0 && (
                    <li className="text-[var(--fg-muted)]">None</li>
                  )}
                  {rejected.map((c) => (
                    <li key={c.id}>
                      {c.productName}: {c.selectionReason ?? c.matchVerdict}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
