import {
  acceptEligibilityWarningAction,
  approveCommercialsAction,
  rejectCommercialsAction,
} from "@/lib/quotes/actions";
import { selectBiddingCompanyAction } from "@/lib/rfq/actions";
import type { SubmissionReadinessResult } from "@/domain/submissionReadiness";
import { pricingEvidenceLabel } from "@/domain/pricingRefresh";

type CompanyOption = {
  id: string;
  legalName: string;
  tradingName: string | null;
};

export function FounderCommercialControls({
  rfqId,
  recommendedCompanyId,
  selectedCompanyId,
  selectionReason,
  companies,
  pricingBasis,
  eligibilityVerdict,
  eligibilityWarningAccepted,
  commercialsApproved,
  readiness,
}: {
  rfqId: string;
  recommendedCompanyId: string | null;
  selectedCompanyId: string | null;
  selectionReason: string | null;
  companies: CompanyOption[];
  pricingBasis: "PROVISIONAL" | "VERIFIED_SUPPLIER";
  eligibilityVerdict: string | null;
  eligibilityWarningAccepted: boolean;
  commercialsApproved: boolean;
  readiness: SubmissionReadinessResult;
}) {
  const recommended = companies.find((c) => c.id === recommendedCompanyId);
  const selected = companies.find((c) => c.id === selectedCompanyId);

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">Pricing evidence hierarchy</div>
        <div className="panel-body text-sm">
          <span
            className={`badge ${
              pricingBasis === "VERIFIED_SUPPLIER" ? "badge-green" : "badge-amber"
            }`}
          >
            {pricingEvidenceLabel(pricingBasis)}
          </span>
          <p className="muted mt-2 text-xs">
            PUBLIC_PRICE_REFERENCE remains provisional and is never treated as
            SUPPLIER_QUOTE.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Company selection / override</div>
        <div className="panel-body space-y-2 text-sm">
          <p>
            Recommended:{" "}
            <strong>
              {recommended?.tradingName ?? recommended?.legalName ?? "—"}
            </strong>
          </p>
          <p>
            Current:{" "}
            <strong>
              {selected?.tradingName ?? selected?.legalName ?? "—"}
            </strong>
          </p>
          {selectionReason && (
            <p className="muted text-xs whitespace-pre-wrap">{selectionReason}</p>
          )}
          <form action={selectBiddingCompanyAction} className="grid gap-2 md:grid-cols-2">
            <input type="hidden" name="rfqId" value={rfqId} />
            <div className="field">
              <label htmlFor="companyId">Select / override company</label>
              <select
                id="companyId"
                name="companyId"
                defaultValue={selectedCompanyId ?? ""}
                required
              >
                <option value="">Select…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tradingName ?? c.legalName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="overrideReason">
                Override reason (required if changing recommendation)
              </label>
              <input id="overrideReason" name="overrideReason" />
            </div>
            <button type="submit" className="btn btn-primary md:col-span-2">
              Save company selection
            </button>
          </form>
        </div>
      </div>

      {eligibilityVerdict === "ELIGIBLE_WITH_WARNING" && (
        <div className="panel">
          <div className="panel-header">Eligibility warning</div>
          <div className="panel-body space-y-2 text-sm">
            <p>
              Verdict: <span className="badge badge-amber">{eligibilityVerdict}</span>
            </p>
            {eligibilityWarningAccepted ? (
              <p className="badge badge-green">Warning accepted</p>
            ) : (
              <form action={acceptEligibilityWarningAction}>
                <input type="hidden" name="rfqId" value={rfqId} />
                <button type="submit" className="btn btn-primary">
                  ACCEPT_ELIGIBILITY_WARNING
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">Founder commercial actions</div>
        <div className="panel-body flex flex-wrap gap-2 text-sm">
          <form action={approveCommercialsAction}>
            <input type="hidden" name="rfqId" value={rfqId} />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pricingBasis !== "VERIFIED_SUPPLIER"}
            >
              APPROVE_COMMERCIALS
            </button>
          </form>
          <form action={rejectCommercialsAction} className="flex gap-1">
            <input type="hidden" name="rfqId" value={rfqId} />
            <input
              name="reason"
              placeholder="Reject reason"
              required
              className="text-sm"
            />
            <button type="submit" className="btn">
              REJECT_COMMERCIALS
            </button>
          </form>
          {commercialsApproved && (
            <span className="badge badge-green">Commercials approved</span>
          )}
        </div>
        <p className="panel-body muted text-xs">
          Commercial approval does not imply READY_TO_SUBMIT while mandatory
          compliance remains open.
        </p>
      </div>

      <div className="panel">
        <div className="panel-header">READY_TO_SUBMIT gate</div>
        <div className="panel-body text-sm">
          <span
            className={`badge ${readiness.readyToSubmit ? "badge-green" : "badge-red"}`}
          >
            {readiness.readyToSubmit ? "READY_TO_SUBMIT" : "NOT READY_TO_SUBMIT"}
          </span>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="muted mt-2 text-xs">
            Gmail / email transport is excluded from this gate.
          </p>
        </div>
      </div>
    </div>
  );
}
