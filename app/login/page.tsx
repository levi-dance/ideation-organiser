"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
          <p style={{ color: "var(--color-ink-muted)" }}>Sign in</p>
        </div>
        <form onSubmit={signIn} className="space-y-3">
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input-notion py-3 text-base"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-base">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    </main>
  );
}
