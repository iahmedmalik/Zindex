import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it's built", description: "The story, the stack and the tests behind Zindex." };

// Real numbers only. Update these when the suites change (see docs/TEST-REPORT.md).
const API_TESTS = 125;
const BROWSER_TESTS = 42; // 21 tests, each in a desktop and a 375 px phone view
const MIGRATIONS = 17;
const REPO = "https://github.com/iahmedmalik/Zindex";

const stack: [string, string][] = [
  ["Web app", "Next.js 16 and React 19, TypeScript. Installable on a phone. Plain CSS with design tokens, one motion vocabulary, light and dark."],
  ["API", "Express 5 and TypeScript, validated with Zod. Sign-in by Better Auth (email, confirmed address, session cookie), sign-up limited to an allow-list, and a demo account that the server signs in itself."],
  ["Database", "PostgreSQL (Neon). Row-level security on every table, so a request can only ever see its own owner's rows."],
  ["Hosting", "Vercel for the web app, Render's free plan for the API (a pinger keeps it awake in shop hours), Neon for the database."],
  ["Tests", "Vitest and a real local Postgres for the API; Playwright for the browser, at desktop and 375 px."],
];

export default function HowItsBuilt() {
  return (
    <main className="page" style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 64px" }}>
      <Link href="/" className="note" style={{ textDecoration: "none" }}>← Back to Zindex</Link>
      <header className="heading"><h1>How Zindex is built</h1><p className="note">For anyone curious about what is under the app.</p></header>

      {/* Draft from verified facts (CV, project notes). Ahmed rewrites this in his own voice before release. */}
      <section className="section">
        <h2>Who built it</h2>
        <p>I&apos;m Ahmed Malik, a computer science graduate from UET Lahore. I build software that real people use, and I design, code, test and ship it myself. Zindex is one of my portfolio projects.</p>
      </section>

      <section className="section">
        <h2>The story</h2>
        <p>Zindex began with a small group of online shops in Lahore that sell mostly through WhatsApp. Orders arrive as chat messages, invoices were made in a separate tool, stock lived in someone&apos;s head, and customers kept asking &ldquo;who is the rider?&rdquo;.</p>
        <p>I built one place for all of it: enter a chat order in about a minute, keep stock honest, send a proper invoice, and give the customer a link that shows their rider and exactly what to hand over at the door.</p>
      </section>

      <section className="section">
        <h2>Try it</h2>
        <p>Open the <Link href="/sign-in">sign-in page</Link> and press <b>Try the demo</b>. It opens a preloaded shop (three stores, orders at every stage, an invoice, a rider and a delivery card) with a short guided tour. The demo is one shared account that resets every day, so nothing you add stays. If you prefer to type it, the demo login is public on purpose: <span className="num">demo@zindex.app</span> and <span className="num">zindex-demo-2026</span>.</p>
        <p className="note">Real accounts are by invitation only: sign-up is limited to the shop owners&apos; email addresses.</p>
      </section>

      <section className="section">
        <h2>The problem it solves</h2>
        <ul className="ledger" style={{ gap: 8 }}>
          <li>Orders come from WhatsApp, not a website, so entry has to be fast on a phone.</li>
          <li>Local riders from inDrive or Yango are booked by hand, and the rider&apos;s fee goes to the rider, not the shop. The app keeps those two amounts apart so the cash adds up.</li>
          <li>Several stores share one owner but must never share invoice numbers, prices, stock or customers.</li>
          <li>Stock and invoice numbers must never silently drift: stock is an append-only ledger, and numbers have no gaps.</li>
        </ul>
      </section>

      <section className="section">
        <h2>What it does</h2>
        <p>Multi-store orders with seven stages, invoices (draft, final, edit history, in the store&apos;s own colours, A4 or receipt, saved as a picture or a PDF), an in-house stock ledger, customers, rider details with a copy-for-inDrive/Yango text, a public delivery card, COD cash tracking, courier parcels, a dashboard, WhatsApp messages from editable templates, sales and stock reports with Excel files, Shopify order import and product sync, and a full backup download.</p>
      </section>

      <section className="section">
        <h2>The stack</h2>
        <dl style={{ display: "grid", gap: 14, margin: 0 }}>
          {stack.map(([k, v]) => <div key={k}><dt style={{ fontWeight: 700 }}>{k}</dt><dd style={{ margin: 0 }} className="note">{v}</dd></div>)}
        </dl>
      </section>

      <section className="section">
        <h2>Architecture</h2>
        <div className="paper pre">{`Phone or laptop
   │  the web app (Next.js, Vercel) forwards /backend/* to the API,
   │  so the sign-in cookie belongs to the app's own address
   ▼
API (Express, Render)  ──  one transaction per request, with the owner's id set
   │                         for that transaction only
   ▼
PostgreSQL (Neon)  ──  row-level security: an owner's rows are the only rows visible

Customers open  /c/<random link>  with no account. The API answers from one
function that returns only what the card shows. Only a hash of the link is stored.`}</div>
        <p className="note">Three rules shape the data: money is whole rupees as integers; the server works out every total, never the phone; and the things that must not repeat (an order, an invoice, a stock deduction, a parcel) are blocked by unique constraints in the database, not only by code.</p>
      </section>

      <section className="section">
        <h2>Tests</h2>
        <ul className="ledger" style={{ gap: 8 }}>
          <li><span>API tests (real Postgres, each owner isolated)</span><span className="lead" /><span className="num">{API_TESTS}</span></li>
          <li><span>Browser tests (desktop and 375 px phone)</span><span className="lead" /><span className="num">{BROWSER_TESTS} runs</span></li>
          <li><span>Database migrations</span><span className="lead" /><span className="num">{MIGRATIONS}</span></li>
        </ul>
        <p className="note">Includes tests that one owner can never read or change another&apos;s data, that a retried save never makes a second order, that stock is taken out once, that a saved invoice picture matches the paper on screen, that only invited emails can sign up, and that the demo stays inside its limits and resets.</p>
      </section>

      <section className="section">
        <h2>Links</h2>
        <ul className="ledger" style={{ gap: 8 }}>
          <li><a href={REPO}>Source code on GitHub</a></li>
          <li><a href={`${REPO}#readme`}>README</a></li>
          <li><a href={`${REPO}/blob/main/docs/PRD.md`}>Product requirements</a></li>
          <li><a href={`${REPO}/blob/main/docs/TEST-REPORT.md`}>Test report</a></li>
          <li><a href={`${REPO}/blob/main/docs/api/openapi.yaml`}>API description (OpenAPI)</a></li>
        </ul>
      </section>

      <section className="section">
        <h2>Credits</h2>
        <p className="note">Built with Next.js, React, Express, Better Auth, Drizzle ORM, Zod, PostgreSQL, Vitest, Playwright and html-to-image. The typefaces are Figtree (Erik Kennedy and the Figtree Project Authors) and Outfit (Rodrigo Fuenzalida and the Outfit Project Authors), both under the SIL Open Font Licence.</p>
      </section>
    </main>
  );
}
