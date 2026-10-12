import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import type { SessionUser } from "@/lib/auth/session";

const NAV = [
  { href: "/", label: "Operations" },
  { href: "/opportunities", label: "Opportunity Inbox" },
  { href: "/founder-queue", label: "Founder Queue" },
  { href: "/rfqs", label: "BID Workspaces" },
  { href: "/companies", label: "Companies" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/settings/gmail", label: "Outbound (deferred)" },
];

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full">
      <aside className="flex w-56 shrink-0 flex-col bg-[var(--bg-sidebar)] text-[var(--fg-on-dark)]">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="text-lg font-bold tracking-tight">Biddify</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-[var(--fg-on-dark-muted)]">
            RFQ Operations
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-sm px-3 py-2 text-sm font-medium text-[var(--fg-on-dark)] hover:bg-[var(--bg-sidebar-hover)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs text-[var(--fg-on-dark-muted)]">
          <div className="font-semibold text-[var(--fg-on-dark)]">{user.name}</div>
          <div className="mt-0.5">{user.role.replaceAll("_", " ")}</div>
          {user.isDemo && (
            <div className="mt-2">
              <span className="badge badge-demo">DEMO USER</span>
            </div>
          )}
          <form action={logoutAction} className="mt-3">
            <button type="submit" className="btn w-full text-xs">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-white px-5 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--fg-muted)]">
            Internal operating system · Not a public SaaS
          </div>
          <div className="text-xs text-[var(--fg-muted)]">
            Timezone default: Africa/Johannesburg
          </div>
        </header>
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
