import { prisma } from "@/lib/db";
import {
  mapGmailToCompanyAction,
  setCompanyOutboundAction,
  setGmailSendingAction,
  setGlobalOutboundPauseAction,
} from "@/lib/gmail/actions";

export default async function GmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const sp = await searchParams;
  const [accounts, companies, settings] = await Promise.all([
    prisma.gmailAccount.findMany({
      include: { company: true },
      orderBy: { emailAddress: "asc" },
    }),
    prisma.company.findMany({
      where: { isDemo: false, dataMode: "OPERATIONAL" },
      orderBy: { legalName: "asc" },
    }),
    prisma.systemSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gmail & outbound controls</h1>
        <p className="muted mt-1 text-sm">
          Discover connected accounts via OAuth, then map explicitly to a company.
          Tokens are encrypted and never shown. Sending stays off until enabled.
        </p>
      </div>

      {sp.connected && (
        <div className="border border-[var(--border)] bg-[#ecfdf5] px-3 py-2 text-sm">
          Connected account discovered: <span className="mono">{sp.connected}</span>.
          Map it to a company before enabling send.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">Global kill switch</div>
        <div className="panel-body space-y-3 text-sm">
          <div>
            Status:{" "}
            <span
              className={`badge ${settings.globalOutboundPaused ? "badge-red" : "badge-green"}`}
            >
              {settings.globalOutboundPaused
                ? "PAUSE ALL OUTBOUND SOURCING EMAIL"
                : "OUTBOUND ALLOWED (mode still applies)"}
            </span>
          </div>
          <div>
            Outbound mode:{" "}
            <span className="badge badge-slate">{settings.outboundMode}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={setGlobalOutboundPauseAction}>
              <input type="hidden" name="paused" value="true" />
              <button className="btn" type="submit">
                Pause all outbound
              </button>
            </form>
            <form action={setGlobalOutboundPauseAction}>
              <input type="hidden" name="paused" value="false" />
              <button className="btn btn-primary" type="submit">
                Resume outbound (still needs mode + mapping)
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Connect Gmail</div>
        <div className="panel-body space-y-2 text-sm">
          <p>
            Uses Google OAuth (no passwords). Requires{" "}
            <span className="mono">GMAIL_CLIENT_ID</span> /{" "}
            <span className="mono">GMAIL_CLIENT_SECRET</span> in local{" "}
            <span className="mono">.env</span>. Scope rationale:{" "}
            <span className="mono">docs/GMAIL_SCOPES.md</span>.
          </p>
          <a className="btn btn-primary inline-block" href="/api/gmail/start">
            Connect / discover Gmail account
          </a>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">Connected accounts (unmapped until confirmed)</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Company</th>
              <th>Sending</th>
              <th>Map / enable</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="mono text-xs">{a.emailAddress}</td>
                <td>
                  <span className="badge badge-slate">{a.connectionStatus}</span>
                </td>
                <td className="text-xs">
                  {a.company?.legalName ?? (
                    <span className="badge badge-amber">UNMAPPED</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${a.sendingEnabled ? "badge-green" : "badge-red"}`}
                  >
                    {a.sendingEnabled ? "ENABLED" : "DISABLED"}
                  </span>
                </td>
                <td>
                  <form action={mapGmailToCompanyAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="gmailAccountId" value={a.id} />
                    <select
                      name="companyId"
                      className="border border-[var(--border)] px-2 py-1 text-xs"
                      defaultValue={a.companyId ?? ""}
                      required
                    >
                      <option value="" disabled>
                        Select company…
                      </option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.legalName}
                        </option>
                      ))}
                    </select>
                    <button className="btn text-xs" type="submit">
                      Confirm mapping
                    </button>
                  </form>
                  {a.companyId && (
                    <div className="mt-2 flex gap-2">
                      <form action={setGmailSendingAction}>
                        <input type="hidden" name="gmailAccountId" value={a.id} />
                        <input type="hidden" name="enabled" value="true" />
                        <button className="btn text-xs" type="submit">
                          Enable sending
                        </button>
                      </form>
                      <form action={setGmailSendingAction}>
                        <input type="hidden" name="gmailAccountId" value={a.id} />
                        <input type="hidden" name="enabled" value="false" />
                        <button className="btn text-xs" type="submit">
                          Disable sending
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted py-6 text-center">
                  No Gmail accounts connected yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">Company outbound sourcing</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Readiness</th>
              <th>Outbound</th>
              <th>Control</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>{c.legalName}</td>
                <td>
                  <span className="badge badge-slate">{c.readinessOverall}</span>
                </td>
                <td>
                  <span
                    className={`badge ${c.outboundSourcingEnabled ? "badge-green" : "badge-red"}`}
                  >
                    {c.outboundSourcingEnabled ? "ENABLED" : "DISABLED"}
                  </span>
                </td>
                <td className="flex gap-2">
                  <form action={setCompanyOutboundAction}>
                    <input type="hidden" name="companyId" value={c.id} />
                    <input type="hidden" name="enabled" value="true" />
                    <button className="btn text-xs" type="submit">
                      Enable
                    </button>
                  </form>
                  <form action={setCompanyOutboundAction}>
                    <input type="hidden" name="companyId" value={c.id} />
                    <input type="hidden" name="enabled" value="false" />
                    <button className="btn text-xs" type="submit">
                      Disable
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
