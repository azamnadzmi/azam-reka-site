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
| `EASYPARCEL_ID`, `EASYPARCEL_KEY` | `api/calculate-shipping.js` |
| `ADMIN_PASSWORD` | gates `admin.html` and every `api/admin/*` endpoint |
| `RESEND_API_KEY` | order status emails |

See `.env.local.example` for the full list with placeholder values.

**Vercel Hobby's 12-function cap:** count `api/**/*.js` (excluding
`api/_lib/`) before adding a new endpoint — currently 10/12.

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
