import {
  captureSupplierQuoteAction,
  rejectSupplierQuoteAction,
  verifySupplierQuoteAction,
} from "@/lib/quotes/actions";

type Line = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  brandRequirement: string | null;
};

type SupplierOption = { id: string; name: string; email: string | null };

type QuoteRow = {
  id: string;
  supplierName: string;
  evidenceType: string;
  verificationState: string;
  quoteReference: string | null;
  isComplete: boolean;
  deliveryKnown: boolean;
  subtotal: number | null;
  validUntil: Date | null;
};

export function QuoteCaptureForm({
  rfqId,
  lines,
  suppliers,
  quotes,
}: {
  rfqId: string;
  lines: Line[];
  suppliers: SupplierOption[];
  quotes: QuoteRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel-header">Manual supplier quotation capture</div>
        <div className="panel-body space-y-3 text-sm">
          <p className="muted">
            Evidence type is always <span className="mono">SUPPLIER_QUOTE</span>.
            Captured quotes start <span className="mono">UNVERIFIED</span> and
            must be verified before pricing refresh. Public price references are
            never substituted.
          </p>
          <form action={captureSupplierQuoteAction} className="space-y-3">
            <input type="hidden" name="rfqId" value={rfqId} />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="field">
                <label htmlFor="supplierId">Supplier</label>
                <select id="supplierId" name="supplierId" required>
                  <option value="">Select…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="quoteReference">Quote / reference #</label>
                <input id="quoteReference" name="quoteReference" />
              </div>
              <div className="field">
                <label htmlFor="contactPerson">Contact person</label>
                <input id="contactPerson" name="contactPerson" />
              </div>
              <div className="field">
                <label htmlFor="supplierEmail">Supplier email</label>
                <input id="supplierEmail" name="supplierEmail" type="email" />
              </div>
              <div className="field">
                <label htmlFor="quoteDate">Quote date</label>
                <input id="quoteDate" name="quoteDate" type="date" />
              </div>
              <div className="field">
                <label htmlFor="validUntil">Valid until</label>
                <input id="validUntil" name="validUntil" type="date" />
              </div>
              <div className="field">
                <label htmlFor="supplierVatStatus">Supplier VAT status</label>
                <select
                  id="supplierVatStatus"
                  name="supplierVatStatus"
                  defaultValue="UNKNOWN"
                >
                  <option value="VAT_REGISTERED">VAT_REGISTERED</option>
                  <option value="NOT_VAT_REGISTERED">NOT_VAT_REGISTERED</option>
                  <option value="UNKNOWN">UNKNOWN</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="deliveryKnown">Delivery cost known?</label>
                <select id="deliveryKnown" name="deliveryKnown" defaultValue="false">
                  <option value="false">No — UNKNOWN (not free)</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="deliveryCost">Delivery fee (ZAR)</label>
                <input id="deliveryCost" name="deliveryCost" type="number" step="0.01" />
              </div>
              <div className="field">
                <label htmlFor="leadTimeDays">Lead time (days)</label>
                <input id="leadTimeDays" name="leadTimeDays" type="number" />
              </div>
              <div className="field">
                <label htmlFor="deliveryLocation">Delivery location / terms</label>
                <input id="deliveryLocation" name="deliveryLocation" />
              </div>
              <div className="field">
                <label htmlFor="paymentTerms">Payment terms</label>
                <input id="paymentTerms" name="paymentTerms" />
              </div>
              <div className="field">
                <label htmlFor="vatKnown">VAT treatment known?</label>
                <select id="vatKnown" name="vatKnown" defaultValue="false">
                  <option value="false">UNKNOWN</option>
                  <option value="true">Known</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="vatIncluded">Prices VAT-inclusive?</label>
                <select id="vatIncluded" name="vatIncluded" defaultValue="">
                  <option value="">—</option>
                  <option value="true">Inclusive</option>
                  <option value="false">Exclusive</option>
                </select>
              </div>
              <div className="field md:col-span-2">
                <label htmlFor="sourceReference">Source document / reference</label>
                <input id="sourceReference" name="sourceReference" />
              </div>
              <div className="field md:col-span-3">
                <label htmlFor="notes">Notes</label>
                <textarea id="notes" name="notes" rows={2} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>#</th>
                    <th>BOQ</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Brand / Mfr</th>
                    <th>SKU</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((li) => (
                    <tr key={li.id}>
                      <td>
                        <input
                          type="checkbox"
                          name={`line_include_${li.id}`}
                          defaultChecked
                        />
                      </td>
                      <td className="mono">{li.lineNumber}</td>
                      <td className="text-xs">
                        <div className="font-medium">{li.description}</div>
                        {li.brandRequirement && (
                          <div className="muted">Brand: {li.brandRequirement}</div>
                        )}
                        <input
                          type="hidden"
                          name={`line_desc_${li.id}`}
                          value={li.description}
                        />
                      </td>
                      <td className="mono">
                        {li.quantity} {li.unit}
                      </td>
                      <td>
                        <input
                          name={`line_unit_${li.id}`}
                          type="number"
                          step="0.01"
                          className="w-28"
                          placeholder="UNKNOWN if blank"
                        />
                      </td>
                      <td className="space-y-1">
                        <input
                          name={`line_brand_${li.id}`}
                          placeholder="Brand"
                          className="w-28"
                          defaultValue={li.brandRequirement ?? ""}
                        />
                        <input
                          name={`line_mfr_${li.id}`}
                          placeholder="Manufacturer"
                          className="w-28"
                        />
                      </td>
                      <td>
                        <input name={`line_sku_${li.id}`} className="w-24" />
                      </td>
                      <td>
                        <input name={`line_avail_${li.id}`} className="w-24" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="submit" className="btn btn-primary">
              Capture SUPPLIER_QUOTE (unverified)
            </button>
          </form>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">Captured quotations</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Ref</th>
              <th>Evidence</th>
              <th>State</th>
              <th>Subtotal</th>
              <th>Delivery</th>
              <th>Complete</th>
              <th>Valid until</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>{q.supplierName}</td>
                <td className="mono text-xs">{q.quoteReference ?? "—"}</td>
                <td>
                  <span className="badge badge-slate">{q.evidenceType}</span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      q.verificationState === "VERIFIED"
                        ? "badge-green"
                        : q.verificationState === "REJECTED"
                          ? "badge-red"
                          : "badge-amber"
                    }`}
                  >
                    {q.verificationState}
                  </span>
                </td>
                <td className="mono">
                  {q.subtotal != null ? `R ${q.subtotal.toFixed(2)}` : "UNKNOWN"}
                </td>
                <td>{q.deliveryKnown ? "Known" : "UNKNOWN"}</td>
                <td>{q.isComplete ? "Yes" : "No"}</td>
                <td className="text-xs">
                  {q.validUntil
                    ? q.validUntil.toISOString().slice(0, 10)
                    : "—"}
                </td>
                <td className="space-y-1">
                  {q.verificationState !== "VERIFIED" &&
                    q.verificationState !== "REJECTED" && (
                      <form action={verifySupplierQuoteAction}>
                        <input type="hidden" name="rfqId" value={rfqId} />
                        <input type="hidden" name="quoteId" value={q.id} />
                        <button type="submit" className="btn text-xs">
                          Verify
                        </button>
                      </form>
                    )}
                  {q.verificationState !== "REJECTED" && (
                    <form action={rejectSupplierQuoteAction} className="flex gap-1">
                      <input type="hidden" name="rfqId" value={rfqId} />
                      <input type="hidden" name="quoteId" value={q.id} />
                      <input
                        name="reason"
                        placeholder="Reject reason"
                        required
                        className="w-32 text-xs"
                      />
                      <button type="submit" className="btn text-xs">
                        Reject
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={9} className="muted py-6 text-center">
                  No supplier quotations captured yet. Provisional public-price
                  pricing remains unchanged until verified SUPPLIER_QUOTE evidence
                  exists.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
