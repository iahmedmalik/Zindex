# Zindex: product requirements

**Status:** v1.0 build, October 2026. Zindex is a back office for shops that sell on WhatsApp: turn a chat order into an invoice quickly, keep stock honest, and give the customer a delivery card that shows their rider and what to hand over.

## Who it is for

- **The owner**, who runs one to three online shops from a phone, often mid-delivery. Most orders arrive as WhatsApp messages or through referrals, some through a Shopify website. The reference user is the owner of three small shops in Lahore (a food shop, a perfume shop and a clothing shop), interviewed as **R1**.
- **The customer**, who opens one link from WhatsApp on a low-end phone and wants to know who the rider is and what to pay.

One owner login per account in v1. No staff roles. Open sign-up is deliberately not part of v1 (the data is already separated per owner, so it can be switched on later).

## The problems

1. Entering a WhatsApp order into a generic invoice tool is slow and repeats typing.
2. Local deliveries go by inDrive or Yango riders booked by hand. Customers ask "who is the rider?". The rider's fee varies each time and goes to the rider, never to the shop.
3. Three stores share one owner but must keep separate invoice numbers, prices, stock and customers.
4. Stock lives in someone's head. It should move only when the owner confirms an order, never twice, and never block a sale.
5. Cash on delivery needs tracking: what the rider collected, what he handed back.

## Scope of v1.0 (20 issues, all tracked on the project board)

| Area | What the owner can do |
|---|---|
| Accounts and stores | Sign in with a confirmed email; run several stores; each has its own invoice letters, numbering, colour, phone and address. |
| Orders | One-page phone form: customer by phone (saved and reused), items from the catalogue or typed, percent discount, rider fee or courier fee, payment (paid in advance, cash on delivery, pay later), notes. Seven stages. A retried save never makes a second order. |
| Invoices | Draft, then final with the store's next gap-free number. Edits after final are logged. A4 or compact receipt, print or PDF, image to share. |
| Products and stock | A catalogue and price per store. In-house stock as an append-only ledger: one deduction when the order is confirmed, put back only when the owner approves, warnings at zero but sales never blocked. |
| Delivery | Rider details and a ready-made text to paste into inDrive or Yango; a public delivery card link; manual courier parcel records with tracking and failure reasons. |
| Money | The owner marks advance payments received and COD cash handed over; a cash-with-riders summary. |
| Messages | Seven editable WhatsApp templates per store and `wa.me` links. |
| Insight | Dashboard of what needs action today; sales and stock reports with Excel files; complete backup download. |
| Shopify | Import the orders export as pending orders with draft invoices; read-only product sync. Stock is never synced. |

## Money rules (confirmed by the owner)

- Whole rupees only. Discounts are percentages, rounded to the nearest rupee, halves up.
- Two kinds of delivery money. The **rider fee** (inDrive or Yango) is typed per parcel, paid by the recipient straight to the rider, and is never part of the shop's total. The **flat delivery fee** (courier) is part of the shop's total.
- A customer either pays in full in advance (cash, Easypaisa, JazzCash, bank transfer) or pays on delivery. No deposits. When paid in advance, the recipient still pays the rider fee at the door.
- What the recipient hands the rider = the cash-on-delivery amount + the rider fee. The shop receives only the goods total.

## Not in v1.0, on purpose

- No courier integration (PostEx or others) and no WhatsApp Business API: the owner copies details and sends messages with `wa.me`. Both are paid or unconfirmed.
- No staff accounts, no open sign-up, no Urdu (English and PKR only).
- No automatic Shopify stock sync (stock is owned in Zindex).
- Restoring a backup is a later step; v1.0 downloads one.

## Principles

1. Speed on a phone beats completeness: order to invoice stays short.
2. The owner's numbers are trustworthy: stock and invoice numbers never silently drift.
3. What customers see is calm and safe: only what they need, on links that expire.
4. Free: no paid dependencies.

## Acceptance (from the owner's list, mapped to tests)

See [TEST-REPORT.md](TEST-REPORT.md). Every acceptance line has an automated test except entry speed, which is timed by hand with the owner: stores do not mix, a WhatsApp order can be entered and invoiced, a Shopify import makes no duplicates, totals are correct, stock is not deducted before confirmation or twice, local details copy for inDrive or Yango, COD cash is tracked, courier parcels are saved, reports are produced, the app works on a 375 px phone, backups download, and a failed integration leaves the rest working.
