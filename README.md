# Zindex

**Orders, invoices, stock and delivery cards for shops that sell on WhatsApp.**

Zindex turns a chat order into an invoice in about a minute, keeps stock honest, and sends the customer a link that shows their rider and exactly what to hand over at the door. It is built phone first, for an owner who runs a few shops from a phone, and it works the same on a laptop.

<!-- Screenshots and the live address are added at release. -->

## What it does

- **One-page order entry.** Find the customer by phone (saved and reused), tap products, set a percent discount, pick rider, courier or pickup, choose cash on delivery, paid in advance or pay later. The total, and what the customer pays at the door, update as you type.
- **Several stores, one login.** Each store has its own invoice numbers, prices, stock, customers, WhatsApp number and colour. Nothing mixes.
- **Invoices.** A draft first, then final with the store's next gap-free number (`SF-0007`). Changes after that are logged. A4 or compact receipt, print or PDF, or an image to send on WhatsApp.
- **Stock you can trust.** An append-only ledger. Stock leaves once, when you confirm an order; goes back only when you approve; warns at zero but never blocks a sale.
- **Riders without the copy-paste.** One tap copies the pickup, address, map links, parcel and amount for inDrive or Yango. The rider's fee is kept apart from the shop's money, so cash adds up.
- **The delivery card.** A link for the customer: status, rider name, bike number, a call button, and the exact amount to have ready. In the store's own colour. It expires and can be switched off; only a hash of the link is stored.
- **Cash on delivery tracking.** Mark advance payments received and COD cash handed over; see what is still with riders.
- **WhatsApp, free.** Seven editable message templates per store and `wa.me` links. No Business API.
- **Courier parcels** recorded by hand with tracking and failure reasons.
- **Reports** for any dates, per store or together, with Excel files; stock reports; a full backup download.
- **Shopify**: import the orders export as pending orders with draft invoices (importing twice adds nothing) and sync products (names, prices, pictures; never stock).
- **Light, dark, and a calmer motion setting;** installable on a phone.

## How it is built

Next.js 16 and React 19 (TypeScript) on Vercel; an Express 5 API on Render; PostgreSQL on Neon with **row-level security on every table**, so a request can only ever see its own owner's rows. Sign-in by Better Auth. More in the app's **How it's built** page and in [docs/](docs/).

```
web/   the Next.js app (screens, motion, installable)
api/   the Express API, SQL migrations (api/sql), tests (api/test), scripts
docs/  PRD, test plan and report, API description (OpenAPI) and a request collection
```

Decisions worth reading: money is whole rupees as integers and the server works out every total; things that must never repeat (an order, an invoice, a stock deduction, a parcel) are stopped by unique constraints in the database; the app's database role cannot edit or delete the stock ledger.

## Run it on your computer

Needs Node 22.

```bash
npm install
npm run dev:db -w @zindex/api        # a real local PostgreSQL (leave it running)
cp api/.env.example api/.env.local   # then set WEB_ORIGIN=http://localhost:3500
npm run dev:api                      # the API on :4000 (new terminal)
npm run seed -w @zindex/api          # a demo owner with three stores and sample orders
npm run dev:web                      # the app on :3500
```

Sign in as `demo@zindex.test` with the password `zindex-demo-1234` (local development only).

## Tests

```bash
npm test                                # API tests on a real local PostgreSQL (also run in CI)
npm run test:e2e -w @zindex/web         # browser tests, desktop and a 375 px phone (stack must be running)
npm run test:smoke -w @zindex/web       # the short set to run after a deploy (E2E_BASE_URL=…)
npm run load -w @zindex/api             # a load test with real numbers
```

Numbers and results are in [docs/TEST-REPORT.md](docs/TEST-REPORT.md); the plan is in [docs/TEST-PLAN.md](docs/TEST-PLAN.md).

## API

[docs/api/openapi.yaml](docs/api/openapi.yaml) describes every route; [docs/api/zindex.http](docs/api/zindex.http) is a collection you can run from VS Code.

## Deploying

The API deploys from [render.yaml](render.yaml) (secrets are entered in Render's dashboard, never in the repo); the web app on Vercel with `API_URL` pointing at the API; the database on Neon, with the migrations applied by `npm run db:migrate -w @zindex/api`. The free API sleeps when idle, so the app shows a "waking up" screen when the server is asleep, and a free pinger is planned to keep it awake during shop hours.

## Licence

MIT. See [LICENSE](LICENSE).
