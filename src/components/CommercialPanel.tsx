import { formatPercent, formatZar } from "@/lib/format";
import { GateBadge } from "@/components/StatusBadge";
import { evidenceLabel, type QuoteEvidenceType } from "@/domain/quoteEvidence";

export function CommercialPanel({
  scenario,
  companyVatRegistered,
}: {
  scenario: {
    name: string;
    supplierCostTotal: { toString(): string } | number;
    supplierInputVatCost?: { toString(): string } | number | null;
    deliveryCost: { toString(): string } | number;
    contingencyCost: { toString(): string } | number;
    landedCost: { toString(): string } | number;
    markupPercent: { toString(): string } | number;
    sellingPriceExVat: { toString(): string } | number;
    vatAmount: { toString(): string } | number;
    totalQuotation: { toString(): string } | number;
    grossProfit: { toString(): string } | number;
    grossMarginPercent: { toString(): string } | number;
    upfrontCashRequired?: { toString(): string } | number | null;
    workingCapitalRequired: { toString(): string } | number;
    expectedRecoveryDays?: number | null;
    supplierPaymentTerms?: string | null;
    buyerPaymentTerms?: string | null;
    financingAssumption?: string | null;
    evidenceQuality?: string | null;
    profitabilityGate: string;
    profitabilityReasons?: string | null;
    notes?: string | null;
  } | null;
  companyVatRegistered?: boolean | null;
}) {
  if (!scenario) {
    return (
      <div className="panel panel-body muted text-sm">
        No pricing scenario yet. Run document extraction, supplier sourcing and
        quote/price evidence first.
      </div>
    );
  }

  let reasons: string[] = [];
  try {
    reasons = scenario.profitabilityReasons
      ? JSON.parse(scenario.profitabilityReasons)
      : [];
  } catch {
    reasons = scenario.profitabilityReasons
      ? [scenario.profitabilityReasons]
      : [];
  }

  const n = (v: { toString(): string } | number | null | undefined) =>
    v == null ? null : Number(v);

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">
          <span>Proposed bid — {scenario.name}</span>
          <GateBadge gate={scenario.profitabilityGate} />
        </div>
        <div className="panel-body grid gap-3 text-sm md:grid-cols-3">
          <Fact label="Goods / acquisition" value={formatZar(n(scenario.supplierCostTotal) ?? 0)} />
          <Fact
            label="Irrecoverable input VAT"
            value={formatZar(n(scenario.supplierInputVatCost) ?? 0)}
          />
          <Fact label="Delivery / logistics" value={formatZar(n(scenario.deliveryCost) ?? 0)} />
          <Fact label="Contingency" value={formatZar(n(scenario.contingencyCost) ?? 0)} />
          <Fact label="Landed cost" value={formatZar(n(scenario.landedCost) ?? 0)} />
          <Fact label="Markup %" value={formatPercent(n(scenario.markupPercent) ?? 0)} />
          <Fact label="Selling (ex VAT)" value={formatZar(n(scenario.sellingPriceExVat) ?? 0)} />
          <Fact label="Output VAT" value={formatZar(n(scenario.vatAmount) ?? 0)} />
          <Fact label="Total bid price" value={formatZar(n(scenario.totalQuotation) ?? 0)} />
          <Fact label="Expected GP" value={formatZar(n(scenario.grossProfit) ?? 0)} />
          <Fact label="Expected margin" value={formatPercent(n(scenario.grossMarginPercent) ?? 0)} />
          <Fact
            label="VAT registered (company)"
            value={
              companyVatRegistered == null
                ? "—"
                : companyVatRegistered
                  ? "YES"
                  : "NO"
            }
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Working capital</div>
        <div className="panel-body grid gap-3 text-sm md:grid-cols-2">
          <Fact
            label="Upfront cash required"
            value={formatZar(
              n(scenario.upfrontCashRequired) ??
                n(scenario.workingCapitalRequired) ??
                0,
            )}
          />
          <Fact
            label="Expected recovery"
            value={
              scenario.expectedRecoveryDays != null
                ? `${scenario.expectedRecoveryDays} days`
                : "—"
            }
          />
          <Fact label="Supplier terms" value={scenario.supplierPaymentTerms ?? "—"} />
          <Fact label="Buyer terms" value={scenario.buyerPaymentTerms ?? "—"} />
          <div className="md:col-span-2">
            <Fact label="Financing assumption" value={scenario.financingAssumption ?? "—"} />
          </div>
          <div className="md:col-span-2">
            <Fact label="Evidence quality" value={scenario.evidenceQuality ?? "—"} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Commercial gate reasons</div>
        <ul className="panel-body list-disc space-y-1 pl-5 text-sm">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {scenario.notes && (
          <div className="border-t border-[var(--border)] px-4 py-3 text-xs muted">
            {scenario.notes}
          </div>
        )}
      </div>
    </div>
  );
}

export function EvidenceBadge({ type }: { type: string }) {
  const label = evidenceLabel(type as QuoteEvidenceType);
  const cls =
    type === "SUPPLIER_QUOTE"
      ? "badge-green"
      : type === "PUBLIC_PRICE_REFERENCE"
        ? "badge-amber"
        : "badge-slate";
  return <span className={`badge ${cls}`}>{label}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
