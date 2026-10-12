import { GateBadge } from "@/components/StatusBadge";
import { NO_BID_CATEGORIES } from "@/domain/nobid";
import { OPPORTUNITY_CLASSES } from "@/domain/classification";
import {
  overrideClassificationAction,
  overrideQualificationAction,
  proceedToReviewAction,
  recordNoBidAction,
} from "@/lib/rfq/actions";

export function QualificationPanel({
  rfqId,
  classification,
  classificationConfidence,
  classificationReasoning,
  qualificationGate,
  qualificationReasons,
  nextAction,
  nextActionReason,
  status,
}: {
  rfqId: string;
  classification?: string | null;
  classificationConfidence?: number | null;
  classificationReasoning?: string | null;
  qualificationGate: string;
  qualificationReasons?: string | null;
  nextAction?: string | null;
  nextActionReason?: string | null;
  status: string;
}) {
  let reasons: string[] = [];
  try {
    reasons = qualificationReasons ? JSON.parse(qualificationReasons) : [];
  } catch {
    reasons = qualificationReasons ? [qualificationReasons] : [];
  }

  const canDecide = !["NO_BID", "CANCELLED", "SUBMITTED", "AWARDED", "PAID"].includes(
    status,
  );

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">
          <span>Can we bid? Should we bid?</span>
          <GateBadge gate={qualificationGate} />
        </div>
        <div className="panel-body space-y-3 text-sm">
          <div>
            <div className="metric-label">Classification</div>
            <div className="mt-1 font-semibold">
              {classification?.replaceAll("_", " ") ?? "—"}
              {classificationConfidence != null && (
                <span className="muted font-normal">
                  {" "}
                  · {(classificationConfidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
            <p className="muted mt-1 text-xs">{classificationReasoning}</p>
          </div>

          <div>
            <div className="metric-label">Qualification reasons</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {reasons.length === 0 && <li className="muted">No reasons captured.</li>}
            </ul>
          </div>

          <div className="border border-[var(--border)] bg-[#f8fafc] px-3 py-2">
            <div className="metric-label">Next action</div>
            <div className="mt-1 font-semibold">
              {nextAction?.replaceAll("_", " ") ?? "—"}
            </div>
            <p className="muted mt-1 text-xs">{nextActionReason}</p>
          </div>

          {canDecide && (
            <div className="grid gap-3 border-t border-[var(--border)] pt-3 md:grid-cols-3">
              <form action={proceedToReviewAction} className="space-y-2">
                <input type="hidden" name="rfqId" value={rfqId} />
                <div className="metric-label">Proceed</div>
                <button type="submit" className="btn btn-primary w-full text-xs">
                  Proceed (REVIEW / QUALIFIED)
                </button>
              </form>

              <form action={overrideQualificationAction} className="space-y-2">
                <input type="hidden" name="rfqId" value={rfqId} />
                <div className="field">
                  <label htmlFor="q-override">Override gate</label>
                  <select
                    id="q-override"
                    name="override"
                    className="border border-[var(--border-strong)] bg-white px-2 py-2"
                    defaultValue={qualificationGate === "UNREVIEWED" ? "AMBER" : qualificationGate}
                  >
                    <option value="GREEN">GREEN</option>
                    <option value="AMBER">AMBER</option>
                    <option value="RED">RED</option>
                  </select>
                </div>
                <button type="submit" className="btn w-full text-xs">
                  Save override
                </button>
              </form>

              <form action={recordNoBidAction} className="space-y-2">
                <input type="hidden" name="rfqId" value={rfqId} />
                <div className="field">
                  <label htmlFor="nobid-cat">NO BID</label>
                  <select
                    id="nobid-cat"
                    name="category"
                    className="border border-[var(--border-strong)] bg-white px-2 py-2"
                    defaultValue="OTHER"
                  >
                    {NO_BID_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="nobid-notes">Notes</label>
                  <input id="nobid-notes" name="notes" placeholder="Required for OTHER" />
                </div>
                <button type="submit" className="btn w-full text-xs">
                  Record NO BID
                </button>
              </form>
            </div>
          )}

          <form
            action={overrideClassificationAction}
            className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3"
          >
            <input type="hidden" name="rfqId" value={rfqId} />
            <div className="field">
              <label htmlFor="class-override">Manual classification override</label>
              <select
                id="class-override"
                name="override"
                className="border border-[var(--border-strong)] bg-white px-2 py-2"
                defaultValue={classification ?? "OTHER"}
              >
                {OPPORTUNITY_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn text-xs">
              Apply classification
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
