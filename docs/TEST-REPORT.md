# Zindex: test report

**Run:** 30 October 2026 (v1.1: a discount on one item, edit and delete an order at any stage, customers by name and editable), on the developer's Windows 10 computer, Node 22, a local PostgreSQL, desktop Edge (Chromium). The web server for the browser run was started with its clock on UTC, as Vercel's is.

## Results

| Suite | Result |
|---|---|
| API tests (Vitest, real local PostgreSQL) | **207 passed**, 0 failed, 31 test files |
| Browser tests (Playwright, against the production build) | **126 passed**, 0 failed: 63 tests, each run at desktop 1280 px and a 375 px phone view (includes the saved-invoice-picture comparison, the tour, the demo, the customer card following the order, and the cash views) |
| Typecheck | web and API clean |
| Production build (Next.js) | passes |
| Dependency audit (`npm audit`) | 0 vulnerabilities |
| Accessibility (axe-core, WCAG 2 A/AA including colour contrast), page overflow and touch-target size (run 28 Oct, not repeated since the 29 Oct changes) | 11 screens x laptop and 375 px x light and dark = 44 page views: **0 axe violations, 0 pages wider than the screen**. Two touch-size notes, both by design: a visually hidden radio behind a custom control, and the options inside a 46 px segmented control |
| CI (GitHub Actions: typecheck, tests, build) | green on every API commit |

## Defects found by testing, and fixed

| Found by | Defect | Fix |
|---|---|---|
| Walking the app at 375 px | The store picker in the top bar was invisible (white text on a white box) | Colour set from the theme |
| Walking the app at 375 px | A long map link made the order page wider than the phone | Text now wraps |
| Phone width, after the card link was made | The whole order page grew sideways (558 px) because a grid column grew to fit an unbreakable link | Columns may now shrink below their content |
| Measuring contrast in the browser | The delivery card's dark-brown store colour was unreadable on the dark theme (2.4:1) | The store colour is lightened on the dark theme |
| Measuring contrast | Green and amber status badges were just under the limit (4.4 to 4.5 against 4.5) | Darker inks, softer tint |
| Browser test | The paper-size switch on the invoice looked unresponsive for a moment because it waited for the page transition | The switch moves at once; only the paper animates |
| Browser test | Closed (folded) panels still had buttons that could be tabbed to and were read by screen readers | Closed panels are hidden from the keyboard and screen readers, and still fold away smoothly |
| Browser test on a phone (found while testing the redesign) | The floating "New order" button sat on top of the order page's action bar at the bottom of the page and could cover "Confirm order" | Pages with their own action bar hide the floating button |
| Accessibility check (axe) | Today had no main heading for screen readers; the logo link, "See all" and the store-colour swatches were smaller than 44 px | Hidden Today heading added; those targets are now 44 px |
| Looking at the new invoice on screen | The invoice body was blank: its class names (`.sheet`, `.hero`, `.paper`...) collided with older classes in the same stylesheet (a bottom sheet that is hidden off screen, 16 px of extra padding) | The invoice classes now carry their own prefix (`iv-`, `ivp`) |
| API test for owner-only sign-up | Refusing a stranger inside the database hook was hidden by the sign-in library behind a fake success, so the person saw no message | The sign-up request itself is checked first and answers 403 with a plain message; the database hook stays as a second lock |
| Looking at the guided tour | The tour skipped the floating "New order" button (a fixed element has no layout parent, so the "is it on the page" check said no) | The check uses the element's drawn size instead |
| Browser test of the tour | Pressing Escape before the tour card had finished fading in did nothing (the key was only heard once focus was inside the card), so the tour stayed open and blocked the page | Escape is now heard from anywhere while the tour is open; the Tab and Shift+Tab loop goes round all its buttons |
| Browser test, first run | The saved-picture test compared the picture with a screenshot that had the sticky top bar and a toast on top of the paper (a defect in the test) | The test hides those bars and takes its screenshot before saving; the difference is now under 8 of 255 |
| API test while building reports | A cancelled order was counted in "orders today" in my own expectation; the code was right | Test expectation corrected |
| The owner on the live site | The link in the confirmation email opened a 404 page (the API builds it on the web address, which only forwarded `/backend/*`) | `/v1/auth/*` is forwarded to the API too |
| The owner on a phone | The order status on the customer's card did not move unless a rider was saved (the card followed a second, rider-only status) | One status: the order's; the card follows it with or without a rider |
| The owner on a phone | Today's six tiles all opened the unfiltered order list | Each tile opens the orders it counts (`?view=`, `?status=`), with a chip to clear it |
| The owner on a phone | Cash from a courier company, paid days later, could not be marked received; the cash button also needed a saved rider | Cash can be marked received on any cash-on-delivery order, and a "Cash to collect" list finds the ones still owing |
| The owner on a phone | The saved invoice picture was soft (720 px wide) and its rounded header corners showed white | Drawn about 1,800 px wide with square corners; a test checks width and the top corners |
| Running the server on UTC like Vercel | The rider photo time on the customer's card was 5 hours behind Pakistan time | The card formats times in Asia/Karachi; a test compares the shown time with the clock |

## Load test (API only)

`npm run load -w @zindex/api`: 8 requests at once, 8 seconds per call, signed in as one owner, against the API running **unbuilt (tsx) on a developer laptop with a local PostgreSQL**. This is a floor, not a production figure: the free hosted API will be slower on the first request after sleeping.

| Call | Requests | Per second | Median | 95th percentile | Errors |
|---|---|---|---|---|---|
| GET dashboard | 1,726 | 215.8 | 32.2 ms | 62.4 ms | 0 |
| GET orders (list) | 1,479 | 184.9 | 40.2 ms | 68.3 ms | 0 |
| GET stock | 1,921 | 240.1 | 30.2 ms | 54.8 ms | 0 |
| GET public delivery card | 120 | 15.0 | 19.2 ms | 27.7 ms | 0 |
| POST order (create) | 635 | 79.4 | 62.7 ms | 252.4 ms | 0 |

The delivery card stops at 120 requests a minute per address on purpose (the rate limiter); the extra requests were answered `429` and are not counted as errors. A shop with three stores makes a few requests a minute, so there is a very large margin.

## Not yet tested

- **Real Shopify**: the order import was tested against a file in Shopify's standard export layout that I wrote, and the product sync against a stand-in Shopify. Both need one check against the owner's real export and real app keys.
- **Real email** (sign-up confirmation, password reset): tested with an in-memory mailer; the live sender is set up at deploy. The sender is a personal mailbox without its own DKIM/DMARC records, so a confirmation email may land in spam; the first sign-ins are checked by hand.
- **The demo in production**: tested locally (preloaded data, guard rails, daily reset); it is switched on and checked live at deploy.
- **Saving to the phone gallery**: a web page cannot write to the gallery silently; the "Save to gallery" button opens the phone's share sheet. Tested as a downloaded picture; the share sheet itself needs the owner's real phone.
- **Real phone**: the layout was tested at 375 px in a browser; the owner's own phone check is part of the release.
- **Entry speed**: "a WhatsApp order in about a minute" has not been timed with the owner yet.
- **Screen reader and keyboard-only pass**: not done by a person yet.
