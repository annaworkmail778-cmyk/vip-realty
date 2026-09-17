"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Sign-in failed.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8">
      <label className="block">
        <span className="label text-ivory/40">Password</span>
        <input
          type="password"
          value={password}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border-b border-ivory/15 bg-transparent py-3 text-ivory outline-none transition-colors duration-300 focus:border-champagne"
        />
      </label>

      {error && <p role="alert" className="label mt-4 text-champagne">{error}</p>}

      <button
        type="submit"
        disabled={busy || !password}
        className="label-lg mt-7 w-full bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
