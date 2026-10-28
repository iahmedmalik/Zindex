"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyVan, Logo } from "@/components/graphics";
import { Seg } from "@/components/ui";
import { api, messageOf } from "@/lib/api";

// Owner sign-in. Creating an account sends a confirmation email (in development the link is printed
// in the API's log). "Forgot password" sends a reset link.
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<"" | "verify" | "reset">("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "up") {
        await api("/auth/sign-up/email", { method: "POST", body: { name, email, password } });
        setSent("verify");
      } else if (mode === "reset") {
        await api("/auth/request-password-reset", { method: "POST", body: { email, redirectTo: `${location.origin}/reset-password` } });
        setSent("reset");
      } else {
        await api("/auth/sign-in/email", { method: "POST", body: { email, password } });
        const next = new URLSearchParams(location.search).get("next");
        router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="solo">
      <div className="panel">
        <div className="heading" style={{ justifyItems: "center", textAlign: "center" }}>
          <Logo size={72} draw />
          <h1 className="word">Zindex</h1>
          <p className="note">Orders, invoices, stock and delivery cards for your shops.</p>
          <EmptyVan />
        </div>
        {sent ? (
          <div className="well arrive">
            <h2>Check your email</h2>
            <p>{sent === "verify" ? `We sent a link to ${email}. Open it to confirm your address, then sign in.` : `If ${email} has an account, a reset link is on its way. It works for one hour.`}</p>
            <button className="btn quiet" onClick={() => { setSent(""); setMode("in"); }}>Back to sign in</button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
            {mode !== "reset" && <Seg label="Sign in or create an account" value={mode} onChange={(v) => { setMode(v); setError(""); }} options={[["in", "Sign in"], ["up", "New account"]] as const} />}
            <div className={`expand${mode === "up" ? " open" : ""}`}><div><label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required={mode === "up"} tabIndex={mode === "up" ? 0 : -1} /></label></div></div>
            <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            <div className={`expand${mode !== "reset" ? " open" : ""}`}><div><label className="field"><span>Password{mode === "up" ? " (10 characters or more)" : ""}</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "up" ? "new-password" : "current-password"} minLength={mode === "in" ? undefined : 10} required={mode !== "reset"} tabIndex={mode !== "reset" ? 0 : -1} /></label></div></div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" disabled={busy}>{busy ? "Please wait…" : mode === "up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
            <button type="button" className="linkbtn" style={{ justifySelf: "start" }} onClick={() => { setMode(mode === "reset" ? "in" : "reset"); setError(""); }}>{mode === "reset" ? "Back to sign in" : "Forgot your password?"}</button>
          </form>
        )}
        <Link className="note" href="/how-its-built" style={{ justifySelf: "center" }}>How it&apos;s built</Link>
      </div>
    </main>
  );
}
