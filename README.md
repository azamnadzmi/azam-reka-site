# Azam Reka — Catalogue Website (Static, WhatsApp Ordering)

No cart, no checkout, no monthly platform fee. This is a plain HTML/CSS/JS
site: browse the catalogue, tap a product, land in WhatsApp with the item
and price already filled in as a message.

## Pages

- `index.html` — homepage
- `catalog.html` — full product grid with category filtering
- `about.html` — brand story
- `contact.html` — custom/bespoke order form (Zoho embed) + WhatsApp link
- `assets/styles.css` — the full design system (same one built for the Shopify version — tokens, kerf-line hover effect, typography, components)
- `assets/main.js` — header scroll state, mobile nav, scroll-reveal animations
- `assets/logo.png` / `assets/logo-dark.png` — your logo

## How to host this for free

**Option A — Netlify (easiest, drag and drop):**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the whole `azam-reka-site` folder onto the page
3. You'll get a live URL immediately (e.g. `random-name.netlify.app`)
4. To use your own domain: Site settings → Domain management → Add a domain — Netlify walks you through pointing your domain's DNS at it

**Option B — GitHub Pages (free, slightly more setup):**
1. Create a free GitHub account and a new repository
2. Upload this folder's contents to it
3. Repository Settings → Pages → set source to the main branch
4. Your site is live at `yourusername.github.io/reponame` (or connect a custom domain the same way)

**Option C — Vercel:** same idea as Netlify, drag-and-drop deploy at [vercel.com/new](https://vercel.com/new).

**Buying a domain:** any registrar works (Namecheap, GoDaddy, Google Domains successor Squarespace Domains) — typically $10–15/year for a `.com`. Point it at whichever host you choose using their DNS instructions.

## How to add a new product

Open `catalog.html`, find the `<!-- PRODUCT GRID -->` comment, and copy one
entire product block (an `<a class="product-card">...</a>` element). Paste
it, then edit these five things:
1. `data-category="..."` — one of `plaques`, `keychains`, `wedding`, `decor`
2. The `href="https://wa.me/601110852324?text=..."` — change the product
   name/price in the text after `text=` (keep the `%20` in place of spaces,
   or just retype the whole message using a URL encoder like
   [urlencoder.org](https://www.urlencoder.org/) if that's easier)
3. The `<img src="...">` — swap in your real product photo
4. The `<span class="product-card__title">` — product name
5. The `<span class="mono-price">` — price

If it's part of a named sub-collection (Floré Minimal, Lace & Love), add a
line above the title: `<span class="product-card__tag">Your Collection</span>`

## How to change the WhatsApp number

The number `601110852324` appears in several places (header button, every
product card, the floating WhatsApp button, the footer, the contact page).
Use your text editor's "Find and Replace across files" — every file in this
folder is plain text, so a simple find/replace of the old number for the
new one covers everything in one pass.

## Design system reference

Same tokens as the Shopify build:

| Token | Value |
|---|---|
| Void (dark bg) | `#14130F` |
| Bone (light bg) | `#F7F3EC` |
| Char (text) | `#2B2A26` |
| Structural (secondary text) | `#8B8880` |
| Ash (borders) | `#DEDACF` |
| Ember (accent) | `#B87333` |

The `.kerf-card` class on any element gives it the signature copper
hover-trace effect used throughout.
