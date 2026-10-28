"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui";
import { api, messageOf } from "@/lib/api";

// Where the password reset email lands (?token=…). The token works once, for one hour.
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = new URLSearchParams(location.search).get("token");
    if (!token) { setError("This link is missing its code. Ask for a new reset email."); return; }
    setBusy(true);
    setError("");
    try {
      await api("/auth/reset-password", { method: "POST", body: { newPassword: password, token } });
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="solo">
      <div className="panel">
        <span className="mark" style={{ fontSize: "var(--t-xl)" }}><Icon name="mark" size={30} />Zindex</span>
        {done ? (
          <div className="well"><h2>Password changed</h2><Link className="btn" href="/sign-in">Sign in</Link></div>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
            <h1>Choose a new password</h1>
            <label className="field"><span>New password (10 characters or more)</span><input className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
