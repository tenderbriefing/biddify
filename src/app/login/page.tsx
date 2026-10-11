import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-full items-center justify-center bg-[linear-gradient(160deg,#0f1c2e_0%,#1f4e79_55%,#dfe7f1_55%,#f4f5f7_100%)] p-6">
      <div className="w-full max-w-md border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[#0f1c2e] px-6 py-5 text-white">
          <div className="text-2xl font-bold tracking-tight">Biddify</div>
          <div className="mt-1 text-xs uppercase tracking-[0.1em] text-[#9aafc4]">
            Internal RFQ operating system
          </div>
        </div>
        <div className="px-6 py-5">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="muted mt-1 text-sm">
            Authorised personnel only. DEMO accounts are labelled and must not
            mix with production procurement data.
          </p>
          <div className="mt-4">
            <LoginForm />
          </div>
          <div className="mt-5 border-t border-[var(--border)] pt-4 text-xs text-[var(--fg-muted)]">
            <div className="font-semibold text-[var(--fg)]">DEMO credentials</div>
            <p className="mt-1">
              founder@demo.biddify.local · password: demo-password-change-me
            </p>
            <p className="mt-1">
              Roles also seeded: admin, bidmanager, reviewer, readonly @
              demo.biddify.local
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
