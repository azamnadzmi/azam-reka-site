# Azam Reka — E-Commerce Site

Full checkout flow: browse the catalogue, add to cart, pay via ToyyibPay,
order lands in Zoho Books and MongoDB, shipping quoted through EasyParcel.
Admin manages production stage and shipment tracking from `admin.html`.

## Where things live

- `index.html`, `catalog.html`, `about.html`, `contact.html` — public pages
- `checkout.html` — cart, shipping, payment
- `track-order.html` — customer-facing order status lookup
- `admin.html` — order management (password-gated; see Environment below)
- `products/*.html` — one page per product, **generated** (see below — don't hand-edit)
- `assets/` — styles, scripts, logo, product photos (`assets/products/`)
- `api/` — Vercel serverless functions (payment, shipping, Zoho sync, admin actions)
- `scripts/` — the catalogue build pipeline (see below)

## The catalogue is generated, not hand-edited

Zoho Books is the source of truth for product **name, price, and
description**. `scripts/catalog-media.json` is the source of truth for
everything Zoho doesn't know: which items are sold online, their category,
collection tag, and their photos/video.

To change a price or product name → edit it in Zoho Books.
To add/remove/re-photograph a product → edit `scripts/catalog-media.json`.
Either way, then run:

```bash
npm run build-catalog          # rebuild from the last Zoho snapshot
npm run build-catalog:refresh  # re-fetch from Zoho first (needs ZOHO_* env vars locally)
```

This regenerates `catalog.html`, every `products/*.html` page,
`api/zoho-item-map.json`, the homepage's hardcoded product cards, and
checkout's thumbnail map — all from those two inputs. It refuses to run if
any product has no collection tag, or if two Zoho items would collide.

Product photos/videos live in `assets/products/`, named `<slug>-NN.jpg`
(sequence order = carousel order) with an optional `<slug>-video.mp4`, which
always renders first in the carousel when present. Source originals are kept
outside this repo, in `E:\AZAMREKA\website\catalog\`.

Run `python scripts/build_catalog.py --dry-run` any time to preview what a
build would change before committing to it.

## Environment variables (set in Vercel → Project Settings)

| Variable | Used by |
|---|---|
| `MONGODB_URI` | order storage — `api/create-payment.js`, `api/order-status.js`, `api/admin/*` |
| `TOYYIBPAY_API_KEY`, `TOYYIBPAY_CATEGORY_CODE` | `api/create-payment.js` |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID` | Zoho Books sync, order creation |
| `EASYPARCEL_CLIENT_ID`, `EASYPARCEL_CLIENT_SECRET`, `EASYPARCEL_REFRESH_TOKEN` | shipping rate check, admin shipment booking, tracking — `api/calculate-shipping.js`, `api/admin/book-shipment.js`, `api/order-status.js` |
| `ADMIN_PASSWORD` | gates `admin.html` and every `api/admin/*` endpoint |
| `RESEND_API_KEY` | order status emails |

See `.env.local.example` for the full list with placeholder values.

**Vercel Hobby's 12-function cap:** count `api/**/*.js` (excluding
`api/_lib/`) before adding a new endpoint — currently 11/12 in normal
operation (12/12 while `api/admin/easyparcel-oauth-callback.js` still exists —
delete it once EasyParcel setup is done, see below).

## Shipping (EasyParcel)

`api/_lib/easyparcel.js` is the one place that talks to EasyParcel. It's a
real OAuth 2.0 (Authorization Code grant) API — Client ID/Secret + a stored
refresh token, same shape as the Zoho integration, not a single API key.
Confirmed by the account's own Developer Hub "Configuration" screen, not by
trusting a summary of it.

**If you're ever re-deriving this integration from scratch: do not trust
prose summaries of easyparcel.github.io/OpenAPI, including from WebFetch-type
tools even when explicitly asked for verbatim content.** Multiple fetches of
that site returned confident, detailed, *wrong* content — one used a field
named `"state"` that directly contradicts the real API's actual field name
(`subdivison_code`, with EasyParcel's own typo). The only content that held up
under cross-checking was the repo's raw **Postman collection JSON**
(`source/Open API Live.postman_collection.json` / `_v3.json`) — a machine
format that gets honestly truncated rather than confidently rewritten — and
`_authentication.md`, which was detailed and internally consistent enough
(real GitHub asset URLs, specific non-generic numbers) to trust. Everything
in `checkRates()` is verified against that JSON. `bookShipment()` and
`trackParcel()` are **not** — see the file's header comment before trusting
them for a real order; test on one low-value shipment first.

**One-time setup**, once `EASYPARCEL_CLIENT_ID`/`_SECRET` are in Vercel and
the app's Redirect URI is set to `https://azamreka.com/api/admin/easyparcel-oauth-callback`:
visit `https://api.easyparcel.com/oauth/login?client_id=<id>&redirect_uri=https://azamreka.com/api/admin/easyparcel-oauth-callback&state=setup`,
log in, click Allow, then open the resulting callback URL with
`&password=<ADMIN_PASSWORD>` appended — it shows the refresh token to save as
`EASYPARCEL_REFRESH_TOKEN`. Delete the callback file afterward.

Bookings are restricted to two couriers — MelPlus (a branded service run by
Poslaju, matched by courier/service name containing "melplus" or "poslaju")
and J&T. Everything else EasyParcel returns is filtered out.

- **Checkout** calls `/api/calculate-shipping` for a live quote as the
  customer fills in postcode + state.
- **Nothing books or spends money automatically.** After payment, an order
  just sits with a structured `shippingAddress` on it. An admin books the
  actual shipment from `admin.html`'s Shipped row ("📦 Book" button) once the
  piece is ready — that's the only thing that calls `EPSubmitOrderBulk` +
  `EPPayOrderBulk` and spends EasyParcel wallet credit.
- **`track-order.html`** shows live tracking once an order has a
  `trackingNumber`, via `EPTrackingBulk`.

Orders placed before this integration existed have no `shippingAddress` —
the Book button won't appear for those; enter tracking numbers by hand
instead, same as before.

## Design tokens

| Token | Value |
|---|---|
| Void (dark bg) | `#14130F` |
| Bone (light bg) | `#F7F3EC` |
| Char (text) | `#2B2A26` |
| Structural (secondary text) | `#8B8880` |
| Ash (borders) | `#DEDACF` |
| Ember (accent) | `#B87333` |

The `.kerf-card` class gives any element the copper hover-trace effect used
throughout the site.
