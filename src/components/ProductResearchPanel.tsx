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
  notes: string | null;
  packSize: unknown;
  packUnit: string | null;
  effectiveUnitCost: unknown;
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

type OptimizerNote = {
  optimizer?: {
    rank?: number;
    spec?: string;
    stock?: string;
    landed?: number | null;
    integrityFirm?: boolean;
    flags?: string[];
  };
};

function parseNotes(notes: string | null): OptimizerNote | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as OptimizerNote;
  } catch {
    return null;
  }
}

export function ProductResearchPanel({
  lines,
  optimizerSummary,
}: {
  lines: Line[];
  optimizerSummary?: Array<{
    lineNumber: number;
    strategy?: {
      type?: string;
      allocations?: Array<{
        supplier: string;
        unitsAllocated: number;
        landedCost: number;
      }>;
      reasoning?: string;
    };
    recommended?: string | null;
    reason?: string;
  }> | null;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg-muted)]">
        Procurement Optimizer comparison — winner is lowest{" "}
        <em>defensible</em> landed cost among integrity-firm, spec-compatible
        candidates. Founder review is optional.
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
        const lineOpt = optimizerSummary?.find(
          (o) => o.lineNumber === line.lineNumber,
        );

        const ranked = [...line.researchCandidates].sort((a, b) => {
          const ra = parseNotes(a.notes)?.optimizer?.rank ?? 999;
          const rb = parseNotes(b.notes)?.optimizer?.rank ?? 999;
          if (ra !== rb) return ra - rb;
          return Number(b.selected) - Number(a.selected);
        });

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

            {lineOpt?.strategy?.type === "SPLIT_SUPPLIER" && (
              <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div className="font-semibold">SPLIT PROCUREMENT</div>
                <ul className="mt-1 text-xs">
                  {(lineOpt.strategy.allocations ?? []).map((a, i) => (
                    <li key={i}>
                      {a.supplier} — {a.unitsAllocated} units · landed{" "}
                      {formatZar(a.landedCost)}
                    </li>
                  ))}
                </ul>
                {lineOpt.strategy.reasoning && (
                  <p className="mt-1 text-xs">{lineOpt.strategy.reasoning}</p>
                )}
              </div>
            )}

            {selected && lineOpt?.strategy?.type !== "SPLIT_SUPPLIER" && (
              <div className="mt-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <div className="font-semibold">RECOMMENDED PROCUREMENT</div>
                <div>{selected.productName}</div>
                <div className="text-xs text-[var(--fg-muted)]">
                  {selected.sourceName}
                  {lineOpt?.reason ? ` · ${lineOpt.reason}` : ""}
                </div>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="ops-table text-xs">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Supplier</th>
                    <th>Product</th>
                    <th>Spec</th>
                    <th>Pack/basis</th>
                    <th>Packs</th>
                    <th>Surplus</th>
                    <th>Unit eq.</th>
                    <th>VAT</th>
                    <th>Delivery</th>
                    <th>Landed</th>
                    <th>Stock</th>
                    <th>Integrity</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((c) => {
                    const opt = parseNotes(c.notes)?.optimizer;
                    const recon = c.packCalculationJson
                      ? JSON.parse(c.packCalculationJson)
                      : null;
                    const del = c.deliveryJson
                      ? JSON.parse(c.deliveryJson)
                      : null;
                    return (
                      <tr
                        key={c.id}
                        className={
                          c.selected ? "bg-emerald-50/80 font-medium" : undefined
                        }
                      >
                        <td className="mono">
                          {opt?.rank != null && opt.rank > 0 ? opt.rank : "—"}
                        </td>
                        <td>{c.sourceName}</td>
                        <td className="max-w-[220px]">
                          {c.productUrl ? (
                            <a
                              href={c.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--accent)] underline"
                            >
                              {c.productName}
                            </a>
                          ) : (
                            c.productName
                          )}
                        </td>
                        <td>{opt?.spec ?? c.matchVerdict}</td>
                        <td>
                          {recon?.supplierPackSize ?? c.packSize ?? "—"} /{" "}
                          {recon?.supplierPriceBasis ?? c.packUnit ?? "—"}
                        </td>
                        <td className="mono">{recon?.packsRequired ?? "—"}</td>
                        <td className="mono">{recon?.surplusUnits ?? "—"}</td>
                        <td className="mono">
                          {recon?.effectiveTenderUnitCost != null
                            ? formatZar(Number(recon.effectiveTenderUnitCost))
                            : c.effectiveUnitCost != null
                              ? formatZar(Number(c.effectiveUnitCost))
                              : "—"}
                        </td>
                        <td>{c.vatTreatment ?? "—"}</td>
                        <td>
                          {del?.type ?? "—"}
                          {del?.known && del?.amount != null
                            ? ` ${formatZar(Number(del.amount))}`
                            : ""}
                        </td>
                        <td className="mono">
                          {opt?.landed != null
                            ? formatZar(opt.landed)
                            : recon?.procurementCost != null
                              ? formatZar(Number(recon.procurementCost))
                              : "—"}
                        </td>
                        <td>{opt?.stock ?? c.availability ?? "—"}</td>
                        <td>
                          {opt?.integrityFirm === true
                            ? "FIRM"
                            : opt?.integrityFirm === false
                              ? "NOT FIRM"
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {ranked.length === 0 && (
                    <tr>
                      <td colSpan={13} className="muted">
                        No candidates
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
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
                      Quantity reconciliation
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                      {pack.humanReadable ??
                        pack.calculation ??
                        JSON.stringify(pack, null, 2)}
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
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-muted)]">
                  Alternatives / rejected
                </h4>
                <ul className="mt-2 space-y-2 text-sm">
                  {alts.map((c) => (
                    <li key={c.id} className="border-t border-[var(--border)] pt-2">
                      {c.productName} ·{" "}
                      {c.priceKnown ? formatZar(Number(c.price)) : "no price"} ·{" "}
                      {c.matchVerdict}
                    </li>
                  ))}
                  {rejected.map((c) => (
                    <li key={c.id} className="text-[var(--fg-muted)]">
                      Rejected: {c.productName}:{" "}
                      {c.selectionReason ?? c.matchVerdict}
                    </li>
                  ))}
                  {alts.length === 0 && rejected.length === 0 && (
                    <li className="text-[var(--fg-muted)]">None</li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
