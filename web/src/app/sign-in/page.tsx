"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyVan, Logo } from "@/components/graphics";
import { Seg } from "@/components/ui";
import { WakeCard } from "@/components/wake";
import { api, messageOf } from "@/lib/api";
import { useWake } from "@/lib/wake";

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
  // Sign-in is a write, which is never repeated, so the buttons wait until the (possibly sleeping) server answers.
  const wake = useWake();

  async function tryDemo() {
    if (!wake.awake) return;
    setBusy(true);
    setError("");
    try {
      await api("/demo/start", { method: "POST", body: {} });
      try { sessionStorage.setItem("zindex.tour.now", "1"); } catch {}
      router.replace("/");
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wake.awake) return;
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
      const text = messageOf(err);
      setError(mode === "in" && /not verified/i.test(text) ? `Your email isn't confirmed yet. We sent a new link to ${email}. Open it, then sign in.` : text);
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
          {wake.phase !== "waking" && <EmptyVan />}
        </div>
        <WakeCard phase={wake.phase} seconds={wake.seconds} wasAsleep={wake.wasAsleep} onAgain={wake.again} />
        {sent ? (
          <div className="well arrive">
            <h2>Check your email</h2>
            <p>{sent === "verify" ? `We sent a link to ${email}. Open it to confirm your address, then sign in. No email? If you signed up before, sign in with this address and we will send a new link.` : `If ${email} has an account, a reset link is on its way. It works for one hour.`}</p>
            <button className="btn quiet" onClick={() => { setSent(""); setMode("in"); }}>Back to sign in</button>
          </div>
        ) : (
          <form className={`stack${wake.awake ? "" : " wakeable"}`} style={{ gap: 16 }} onSubmit={submit}>
            {mode !== "reset" && <Seg label="Sign in or create an account" value={mode} onChange={(v) => { setMode(v); setError(""); }} options={[["in", "Sign in"], ["up", "New account"]] as const} />}
            <div className={`expand${mode === "up" ? " open" : ""}`}><div><p className="note">Zindex is by invitation. Use the email address the owner gave access to.</p></div></div>
            <div className={`expand${mode === "up" ? " open" : ""}`}><div><label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required={mode === "up"} tabIndex={mode === "up" ? 0 : -1} /></label></div></div>
            <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            <div className={`expand${mode !== "reset" ? " open" : ""}`}><div><label className="field"><span>Password{mode === "up" ? " (10 characters or more)" : ""}</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "up" ? "new-password" : "current-password"} minLength={mode === "in" ? undefined : 10} required={mode !== "reset"} tabIndex={mode !== "reset" ? 0 : -1} /></label></div></div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" disabled={busy || !wake.awake}>{busy ? "Please wait…" : wake.phase === "waking" ? "Waiting for the server" : mode === "up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
            <button type="button" className="linkbtn" style={{ justifySelf: "start" }} onClick={() => { setMode(mode === "reset" ? "in" : "reset"); setError(""); }}>{mode === "reset" ? "Back to sign in" : "Forgot your password?"}</button>
            {mode !== "reset" && <p className="demo-line"><button type="button" className="linkbtn demo-link" disabled={busy || !wake.awake} onClick={() => void tryDemo()}>Try the demo</button><span className="note">No sign-up needed.</span></p>}
          </form>
        )}
        <Link className="note" href="/how-its-built" style={{ justifySelf: "center" }}>How it&apos;s built</Link>
      </div>
    </main>
  );
}
