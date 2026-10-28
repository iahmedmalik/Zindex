# Zindex: test plan

## Levels

| Level | Tool | What it proves | Where |
|---|---|---|---|
| Unit | Vitest | The money rules (`calculateTotals`), phone and CSV helpers, the order stage rules, the Shopify column mapping | `api/test/totals.test.ts`, `shopify-import.test.ts`, `reports.test.ts`, `customers.test.ts`, `orders.test.ts` |
| API and database | Vitest + Supertest on a real local PostgreSQL | Every route, the row-level security, and the rules that live in the database (unique indexes, append-only tables, number counters) | `api/test/*.test.ts` |
| System (browser) | Playwright, desktop 1280 px and a 375 px phone view | The flows an owner and a customer actually do | `web/e2e/core.spec.ts` |
| Smoke | Playwright, `@smoke` tests only | After each deploy: sign-in, the order form and its door-cash split, the delivery card, no screen wider than the phone | `npm run test:smoke -w @zindex/web` with `E2E_BASE_URL` |
| Load | `api/scripts/load-test.ts` | How many owner calls per second the API handles, and how fast | `npm run load -w @zindex/api` |

The API tests use a throw-away PostgreSQL that is started on the developer's own computer and in CI (no mocks for the database). Each test makes its own owners with random ids, so tests never depend on each other.

## What must always hold (and the test that holds it)

1. **One owner never sees or changes another's data.** Each feature's test file has a cross-owner case: stores, products, customers, orders, invoices, stock, deliveries, cards, payments, shipments, templates, reports, backup, Shopify, import.
2. **Totals are right.** 13 unit tests on `calculateTotals`; the orders tests check that the server ignores totals sent by the phone; the browser test checks the door-cash split the owner sees against the order page.
3. **No duplicates.** A retried order save (also two at the same instant), a second invoice for one order, a second invoice number, a second stock deduction, a second parcel, a repeated Shopify import.
4. **Stock moves once, on confirmation, and never blocks a sale.** Entered or imported orders do not touch stock; confirming takes it out once; below zero warns; cancel or return puts stock back only when the owner approves; the ledger cannot be edited or deleted by the app's database role.
5. **The customer's card leaks nothing.** No sign-in; only a hash of the link is stored; wrong, expired and switched-off links answer 404; no customer phone or id in the response.
6. **The phone is first-class.** Every browser test runs at 375 px; one test visits every screen and fails if any is wider than the phone; contrast was measured on every screen in light and dark.
7. **Motion has a quiet path.** A test checks that with reduced motion the travel distance is zero and a saved choice survives a reload.

## Out of scope for v1.0

- Real Shopify and real email delivery: these are tested against stand-ins until the owner connects his shops. (The Shopify column names in the CSV import are Shopify's standard export headers; they still need checking against a real export.)
- Real-phone testing is done by the owner on his own phone before release.

## Entry and exit

- **Every commit:** typecheck, API tests, build (CI on GitHub Actions).
- **Before a release:** the full browser suite, the load test, and a manual pass on a real phone.
- **After a deploy:** the `@smoke` set against the live address.
