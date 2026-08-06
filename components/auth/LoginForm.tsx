"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** firstRun: the deployment has no account yet, so create one instead of signing in. */
export default function LoginForm({ firstRun }: { firstRun: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Full navigation (not router.push) so middleware sees the fresh cookies.
    window.location.assign("/");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    if (!firstRun) {
      await signIn();
      return;
    }

    try {
      const res = await fetch("/api/setup/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      // Straight into the app rather than making them retype what they just chose.
      await signIn();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not create the account");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-4">
          <span
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: "var(--color-nblue-100)", color: "var(--color-nblue-600)" }}
          >
            <Brain size={26} strokeWidth={2} />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">Your second brain</h1>
          <p style={{ color: "var(--color-ink-muted)" }}>
            {firstRun ? "Create your account" : "Sign in"}
          </p>
        </div>
        {firstRun && (
          <p className="card p-3 text-sm" style={{ color: "var(--color-ink-muted)" }}>
            Nobody has signed in to this deployment yet, so the first account is yours. Once you
            create it, this form goes back to being a sign-in and nobody else can register.
          </p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input-notion py-3 text-base"
          />
          <input
            type="password"
            required
            minLength={firstRun ? 8 : undefined}
            autoComplete={firstRun ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={firstRun ? "Choose a password (8+ characters)" : "Password"}
            className="input-notion py-3 text-base"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-base">
            {busy
              ? firstRun
                ? "Creating…"
                : "Signing in…"
              : firstRun
                ? "Create account"
                : "Sign in"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  );
}
