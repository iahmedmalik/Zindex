# Zindex: test report

**Run:** 28 October 2026, on the developer's Windows 10 computer, Node 22, a local PostgreSQL, desktop Edge (Chromium).

## Results

| Suite | Result |
|---|---|
| API tests (Vitest, real local PostgreSQL) | **115 passed**, 0 failed, 21 test files |
| Browser tests (Playwright, against the production build) | **34 passed**, 0 failed: 17 tests, each run at desktop 1280 px and a 375 px phone view |
| Typecheck | web clean; API has one known error in `scripts/load-test.ts` (the load-test script, not the server or the tests) |
| Production build (Next.js) | passes, 18 routes |
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
| API test while building reports | A cancelled order was counted in "orders today" in my own expectation; the code was right | Test expectation corrected |

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
- **Real email** (sign-up confirmation, password reset): tested with an in-memory mailer; the live sender is set up at deploy.
- **Real phone**: the layout was tested at 375 px in a browser; the owner's own phone check is part of the release.
- **Entry speed**: "a WhatsApp order in about a minute" has not been timed with the owner yet.
- **Accessibility**: contrast was measured on every screen in light and dark; a screen-reader pass and a keyboard-only pass have not been done.
