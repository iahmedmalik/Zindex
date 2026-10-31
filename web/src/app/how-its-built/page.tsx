import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it's built", description: "The story, the stack and the tests behind Zindex." };

// Real numbers only. Update these when the suites change (see docs/TEST-REPORT.md).
const API_TESTS = 207;
const BROWSER_TESTS = 142; // 71 tests, each in a desktop and a 375 px phone view
const MIGRATIONS = 28;
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

      {/* Written in Ahmed's voice from the project's real history (29 Oct): only things that happened. */}
      <section className="section">
        <h2>Who built it</h2>
        <p>Hi, I&apos;m Ahmed Malik. I studied computer science at UET Lahore, and I like building software for people who will use it on a busy day, not just for a demo. I designed, coded, tested and shipped Zindex myself, mostly on late nights. Its first user is my own brother.</p>
      </section>

      <section className="section">
        <h2>The story</h2>
        <p>My brother runs a few online shops. Most of his orders don&apos;t come from a website: they arrive on WhatsApp, from customers and from people another customer told about him. Invoices were made in a separate tool, deliveries around town go with an inDrive or Yango rider booked by hand, and every customer asks the same thing once the order is on its way: &ldquo;who is the rider?&rdquo;.</p>
        <p>So I built him one place for all of it. An order goes in from a phone, the invoice is made and numbered for him, stock goes down once, and the customer gets a link that shows how their order is doing and, when there is a rider, who is bringing it and exactly what to hand over at the door.</p>
        <p>It got simpler as we used it. The buttons on the home screen open exactly the orders they count, cash that comes back from a courier days later can be ticked off, the invoice makes itself instead of waiting to be finalised, and a button my brother said they never use is gone.</p>
        <p>One honest note: a shop this size could run on something much smaller. I built it with a proper API, a real database that keeps each owner&apos;s data separate, and a lot of tests on purpose, because I also wanted Zindex to show how I build things I would be comfortable leaving in someone&apos;s hands. It all runs on free plans.</p>
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
        <p>Multi-store orders with seven stages, invoices (made and numbered with the order, edit history, in the store&apos;s own colours, A4 or receipt, saved as a picture or a PDF), an in-house stock ledger, customers, optional rider details, a public delivery card, COD cash tracking, courier parcels, a dashboard, WhatsApp messages from editable templates, sales and stock reports with Excel files, Shopify order import and product sync, and a full backup download.</p>
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
