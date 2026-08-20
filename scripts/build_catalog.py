#!/usr/bin/env python3
"""
Azam Reka - Catalogue Builder (Zoho-driven)

Zoho Books is the source of truth for product NAME, PRICE and DESCRIPTION.
scripts/catalog-media.json is the source of truth for which items appear online,
their category, collection tag, and their photos/video.

Regenerates:
  - the product grid inside catalog.html (between PRODUCTS_START/END markers)
  - products/<slug>.html detail pages
  - api/zoho-item-map.json  (product name -> Zoho item_id, used by order creation)

Media order is the carousel order. A video, when present, always shows first.

Usage:
    python scripts/build_catalog.py                 # use scripts/zoho-items.json snapshot
    python scripts/build_catalog.py --refresh       # re-fetch from Zoho first (needs ZOHO_* env vars)
    python scripts/build_catalog.py --dry-run       # report changes, write nothing
"""

import argparse
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(SITE_DIR, "scripts")
ZOHO_ITEMS_PATH = os.path.join(SCRIPTS_DIR, "zoho-items.json")
MEDIA_PATH = os.path.join(SCRIPTS_DIR, "catalog-media.json")
CATALOG_PATH = os.path.join(SITE_DIR, "catalog.html")
PRODUCTS_DIR = os.path.join(SITE_DIR, "products")
ITEM_MAP_PATH = os.path.join(SITE_DIR, "api", "zoho-item-map.json")

PLACEHOLDER_IMG = "assets/products/plaque-01.jpg"


def esc(text):
    return html.escape(str(text)) if text is not None else ""


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-") or "product"


# --------------------------------------------------------------------------- #
# Zoho
# --------------------------------------------------------------------------- #

def fetch_zoho_items():
    """Re-fetch active items from Zoho Books. Requires ZOHO_* env vars."""
    required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"--refresh needs these env vars: {', '.join(missing)}")

    accounts = os.environ.get("ZOHO_ACCOUNTS_DOMAIN", "https://accounts.zoho.com")
    api = os.environ.get("ZOHO_API_DOMAIN", "https://www.zohoapis.com")
    org = os.environ["ZOHO_ORGANIZATION_ID"]

    body = urllib.parse.urlencode({
        "refresh_token": os.environ["ZOHO_REFRESH_TOKEN"],
        "client_id": os.environ["ZOHO_CLIENT_ID"],
        "client_secret": os.environ["ZOHO_CLIENT_SECRET"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(f"{accounts}/oauth/v2/token", data=body) as r:
        token = json.load(r).get("access_token")
    if not token:
        raise SystemExit("Zoho did not return an access token - check the refresh token.")

    items, page = [], 1
    while True:
        url = (f"{api}/books/v3/items?organization_id={org}"
               f"&page={page}&per_page=100&filter_by=Status.Active")
        req = urllib.request.Request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        batch = data.get("items") or []
        if not batch:
            break
        items.extend(batch)
        if not data.get("page_context", {}).get("has_more_page"):
            break
        page += 1

    snapshot = {
        "_comment": ("Snapshot of active Zoho Books items. Refreshed by build_catalog.py --refresh. "
                     "Do not hand-edit prices here - edit them in Zoho Books."),
        "organization_id": org,
        "items": [
            {
                "item_id": i["item_id"],
                "name": i["name"],
                "sku": i.get("sku", ""),
                "rate": i.get("rate", 0),
                "description": i.get("description", ""),
            }
            for i in sorted(items, key=lambda x: x["name"])
        ],
    }
    with open(ZOHO_ITEMS_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    print(f"Refreshed {len(items)} items from Zoho into {os.path.relpath(ZOHO_ITEMS_PATH, SITE_DIR)}")
    return snapshot


def load_zoho_items():
    with open(ZOHO_ITEMS_PATH, encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
# Resolution: media entry + Zoho item -> a renderable product
# --------------------------------------------------------------------------- #

def resolve_products(media, zoho):
    by_id = {i["item_id"]: i for i in zoho["items"]}
    products, warnings = [], []

    for entry in media["products"]:
        name = entry["display_name"]
        if entry.get("active") is False:
            continue
        if not entry.get("tag"):
            raise SystemExit(f"{name} has no collection. Every product must belong to at least one - "
                             f'set "tag" in catalog-media.json.')
        images = [img for img in entry.get("images") or [] if img] or [PLACEHOLDER_IMG]
        variants = []

        if entry.get("variants"):
            # One card, several Zoho items behind a picker. Each variant carts under
            # its own name so it still resolves to the right Zoho line item.
            for v in entry["variants"]:
                item = by_id.get(v["zoho_item_id"])
                if not item:
                    warnings.append(f"{name} / {v['label']}: zoho_item_id {v['zoho_item_id']} not found - skipped")
                    continue
                variants.append({
                    "label": v["label"],
                    "zoho_item_id": v["zoho_item_id"],
                    "name": f"{name} ({v['label']})",
                    "price": float(item["rate"]),
                })
            if not variants:
                warnings.append(f"{name}: no resolvable variants - skipped")
                continue
            price = min(v["price"] for v in variants)
            description = ""
            item_id = None
        else:
            item_id = entry.get("zoho_item_id")
            item = by_id.get(item_id) if item_id else None

            if item_id and not item:
                warnings.append(f"{name}: zoho_item_id {item_id} not found in Zoho - skipped")
                continue

            if item:
                price = float(item["rate"])
                description = item.get("description") or ""
            else:
                price = float(entry.get("fallback_price", 0))
                description = ""
                warnings.append(f"{name}: not linked to Zoho, using fallback price RM {price:.2f}")

            # A catalog-media.json entry can override the Zoho description.
            # Needed when two distinct-design products share one Zoho item
            # (same price/accounting line, different event/description) -
            # without this they'd show identical copy on the website.
            if entry.get("description"):
                description = entry["description"]

        products.append({
            "zoho_item_id": item_id,
            "name": name,
            "slug": slugify(name),
            "category": entry["category"],
            "tag": entry.get("tag"),
            "price": price,
            "sale_price": entry.get("fallback_sale_price"),
            "description": description or f"Custom laser-cut {name.lower()}, made to order by Azam Reka.",
            "images": images,
            "video": entry.get("video"),
            "variants": variants,
        })

    return products, warnings


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #

def build_media_html(product, indent="        ", tag_html=""):
    """Carousel with the video first (when present), then images in listed order.

    tag_html, when given, is the catalogue-card collection tag rendered
    inside the media block (overlaid on the image) - the product-page use
    of this function renders its own tag separately, outside the media.
    """
    slides = []
    if product["video"]:
        slides.append({"type": "video", "src": product["video"]})
    slides += [{"type": "image", "src": img} for img in product["images"]]

    sale_badge = '<span class="sale-badge">Sale</span>\n          ' if product["sale_price"] else ""
    alt = esc(product["name"])

    if len(slides) == 1:
        s = slides[0]
        inner = (f'<video src="{esc(s["src"])}" muted loop playsinline preload="metadata" controls></video>'
                 if s["type"] == "video"
                 else f'<img src="{esc(s["src"])}" alt="{alt}" loading="lazy">')
        return f'''<div class="product-card__media kerf-card">
          {tag_html}{sale_badge}{inner}
        </div>'''

    parts, photo_num = [], 0
    for i, s in enumerate(slides):
        active = " is-active" if i == 0 else ""
        if s["type"] == "video":
            parts.append(f'''            <div class="carousel-slide{active}">
              <span class="video-badge">Video</span>
              <video src="{esc(s["src"])}" muted loop playsinline preload="metadata" controls></video>
            </div>''')
        else:
            photo_num += 1
            parts.append(f'''            <div class="carousel-slide{active}">
              <img src="{esc(s["src"])}" alt="{alt} photo {photo_num}" loading="lazy">
            </div>''')

    dots = "\n".join(
        f'            <button class="carousel-dot{" is-active" if i == 0 else ""}" '
        f'data-index="{i}" aria-label="View item {i + 1}"></button>'
        for i in range(len(slides))
    )

    return f'''<div class="product-card__media kerf-card" data-carousel>
          {tag_html}{sale_badge}<div class="carousel-track">
{chr(10).join(parts)}
          </div>
          <button class="carousel-arrow carousel-arrow--prev" aria-label="Previous">&#8249;</button>
          <button class="carousel-arrow carousel-arrow--next" aria-label="Next">&#8250;</button>
          <div class="carousel-dots">
{dots}
          </div>
        </div>'''


def price_html(product):
    if product["variants"]:
        lo = min(v["price"] for v in product["variants"])
        hi = max(v["price"] for v in product["variants"])
        return f'RM {lo:.2f}' if lo == hi else f'RM {lo:.2f} &ndash; RM {hi:.2f}'
    if product["sale_price"]:
        return (f'RM {product["price"]:.2f} '
                f'<span style="text-decoration: line-through; color: var(--color-structural); '
                f'margin-left: 0.4em;">RM {float(product["sale_price"]):.2f}</span>')
    return f'RM {product["price"]:.2f}'


def build_variant_picker(product, indent="        ", hidden=False):
    """A <select> that rewrites the add-to-cart button's dataset on change.

    On catalogue cards it starts hidden so the grid stays clean - the first
    Add to Cart click reveals it instead of adding. On the product page, where
    choosing is the point, it is visible from the start.
    """
    if not product["variants"]:
        return ""
    opts = "\n".join(
        f'{indent}  <option value="{esc(v["name"])}" data-price="{v["price"]:.2f}">'
        f'{esc(v["label"])} &mdash; RM {v["price"]:.2f}</option>'
        for v in product["variants"]
    )
    return (f'\n{indent}<select data-variant-picker{" hidden" if hidden else ""} '
            f'aria-label="Choose {esc(product["name"])} option" '
            f'style="width:100%; margin-top:0.5rem; padding:0.5em; border:1px solid var(--color-ash); '
            f'background: var(--color-bone); font: inherit; font-size:0.9rem;">\n{opts}\n{indent}</select>')


def build_product_card(product):
    # The whole card is a link to the product detail page - variant choice,
    # quantity, and Add to Cart all happen there, not on the grid. Carousel
    # arrows/dots (and the wishlist heart injected by main.js) call
    # preventDefault/stopPropagation so they don't trigger this navigation.
    tag = f'<span class="product-card__tag">{esc(product["tag"])}</span>\n          ' if product["tag"] else ""
    media = build_media_html(product, tag_html=tag)
    return f'''      <a href="products/{product["slug"]}.html" class="product-card" data-category="{esc(product["category"])}" data-collection="{esc(product["tag"])}">
        {media}
        <div class="product-card__body">
          <span class="product-card__title">{esc(product["name"])}</span>
          <p class="product-card__desc">{esc(product["description"])}</p>
        </div>
        <div class="product-card__footer">
          <span class="mono-price">{price_html(product)}</span>
          <span class="product-card__view">View &rarr;</span>
        </div>
      </a>'''


def build_action_html(product):
    """Qty stepper + (variant picker, if any) + Add to Cart + Buy Now + Ask on WhatsApp.

    Built as one block rather than via template placeholder + string-replace
    hacks, since the variant picker needs to sit between the picker-less
    template's fixed slots.
    """
    first = product["variants"][0] if product["variants"] else None
    btn_name = esc(first["name"]) if first else esc(product["name"])
    btn_price = f'{(first["price"] if first else product["price"]):.2f}'
    name_url = urllib.parse.quote(product["name"])

    picker = build_variant_picker(product, indent="          ", hidden=False)
    picker_html = (picker.lstrip("\n") + "\n          ") if picker else ""

    return f'''{picker_html}<div class="qty-stepper" data-qty-stepper>
            <button type="button" class="qty-stepper__btn" data-qty-stepper-minus aria-label="Decrease quantity">&minus;</button>
            <span class="qty-stepper__value" data-qty-stepper-value>1</span>
            <button type="button" class="qty-stepper__btn" data-qty-stepper-plus aria-label="Increase quantity">+</button>
          </div>
          <button data-add-to-cart="{btn_name}" data-price="{btn_price}" class="btn btn-whatsapp">Add to Cart</button>
          <button data-buy-now="{btn_name}" data-price="{btn_price}" class="btn btn-primary">Buy Now &rarr;</button>
          <a href="https://wa.me/601110852324?text=Hi%20Azam%20Reka%2C%20I%27d%20like%20to%20ask%20about%3A%20{name_url}" class="btn btn-outline">Ask a Question on WhatsApp</a>'''


PRODUCT_PAGE_TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} — Azam Reka</title>
<meta name="description" content="{description}">
<meta property="og:type" content="website">
<meta property="og:title" content="{name} — Azam Reka">
<meta property="og:description" content="{description}">
<meta property="og:image" content="https://azamreka.com/{og_image}">
<meta property="og:url" content="https://azamreka.com/products/{slug}.html">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{name} — Azam Reka">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="https://azamreka.com/{og_image}">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" href="../assets/icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="../assets/icons/apple-touch-icon.png">
<link rel="manifest" href="../assets/site.webmanifest">
<link rel="stylesheet" href="../assets/styles.css">
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{{if(f.fbq)return;n=f.fbq=function(){{n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)}};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2076031446636271');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=2076031446636271&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-229EHNK79E"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());

  gtag('config', 'G-229EHNK79E');
</script>
</head>
<body>

<div class="promo-bar">
  <button class="promo-arrow promo-arrow--prev" aria-label="Previous announcement">&#8249;</button>
  <div class="promo-track">
    <div class="promo-slide is-active">Custom Wedding &amp; Hari Guru orders now open &mdash; <a href="/contact.html">WhatsApp for a quote</a></div>
    <div class="promo-slide">Rated 5.0 on Google &mdash; loved by teachers &amp; newlyweds</div>
    <div class="promo-slide">Placed an order? <a href="/track-order.html">Track it here</a></div>
  </div>
  <button class="promo-arrow promo-arrow--next" aria-label="Next announcement">&#8250;</button>
</div>

<header class="site-header" data-scrolled="false">
  <div class="container site-header__inner">
    <a href="../index.html" class="site-header__logo" aria-label="Azam Reka">
      <svg class="site-header__logo-svg" viewBox="0 0 123.27 117.02" style="height:42px; width:auto;" role="img" aria-label="Azam Reka">
        <path fill="#231f20" d="M113.14,54.04c0-4.06-2.43-7.73-6.16-9.31L9.76,3.46v20.08l83.1,35.27v21.66L23.81,51.17c-6.66-2.83-14.05,2.06-14.05,9.3v51.7l20.28-8.61v-27.71l83.1,35.27v-22.03l-20.12-8.54,20.12-8.54v-17.97Z"/>
        <circle class="logo-dot" fill="#231f20" cx="47.49" cy="102.05" r="10.11"/>
      </svg>
    </a>
    <nav class="site-header__nav">
      <a href="../about.html">About</a>
      <a href="../catalog.html">Catalogue</a>
      <a href="../index.html#how-to-order">Process</a>
      <a href="../track-order.html">Track</a>
      <a href="../faq.html">FAQ</a>
    </nav>
    <div class="site-header__actions" style="display:flex; align-items:center; gap: 1rem;">
      <button data-cart-btn class="cart-button" aria-label="Shopping cart" style="background:none; border:none; cursor:pointer; font-size:0;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <span data-cart-count class="cart-count"></span>
      </button>
      <a href="../contact.html" class="btn btn-primary" style="padding: 0.6em 1.2em;">Custom Orders</a>
      <button class="site-header__mobile-toggle" data-mobile-nav-toggle aria-label="Open menu" aria-expanded="false">&#9776;</button>
    </div>
  </div>
  <div class="mobile-nav" data-mobile-nav data-open="false" style="display:none; flex-direction:column; padding: 1rem clamp(1.25rem,4vw,4rem); border-top: 1px solid var(--color-ash); background: var(--color-bone);">
    <a href="../about.html" style="padding-block:0.5em;">About</a>
    <a href="../catalog.html" style="padding-block:0.5em;">Catalogue</a>
    <a href="../index.html#how-to-order" style="padding-block:0.5em;">Process</a>
    <a href="../track-order.html" style="padding-block:0.5em;">Track</a>
    <a href="../faq.html" style="padding-block:0.5em;">FAQ</a>
    <a href="../contact.html" style="padding-block:0.5em;">Custom Orders</a>
  </div>
</header>

<section class="section">
  <div class="container">
    <p class="font-micro" style="color: var(--color-structural); margin-bottom: var(--space-3);">
      <a href="../catalog.html" style="color: var(--color-structural);">Catalogue</a> &rsaquo; {name}
    </p>
    <div class="grid-2" style="align-items: flex-start; gap: var(--space-5);">
      <div class="corner-frame">
        {media_html}
      </div>
      <div>
        {tag_html}
        <h1 class="h-display-3" style="margin-top: 0.4em;">{name}</h1>
        <p class="mono-price" style="margin-top: 0.6em;">{price_html}</p>
        <div class="product-review-chip"><span class="product-review-chip__stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span><span>5.0 &middot; <a href="https://www.google.com/maps/place/AzamReka/@1.4593967,103.7670874,1086m/data=!3m1!1e3!4m8!3m7!1s0x31da138f5091b1bb:0x7218c566eebdef7d!8m2!3d1.4593913!4d103.7696623!9m1!1b1!16s%2Fg%2F11ybzzxvzt" target="_blank" rel="noopener">11 Google Reviews</a></span></div>
        <p class="body-base" style="margin-top: var(--space-3); max-width: 46ch; color: var(--color-char);">{description}</p>
        <div style="margin-top: var(--space-4);">
          <p class="font-micro" style="color: var(--color-structural); margin-bottom: 0.75em;">Specifications</p>
          <ul class="spec-list" data-specs-placeholder>
            <li>Material — <em>add material</em></li>
            <li>Size — <em>add dimensions</em></li>
            <li>Thickness — <em>add thickness</em></li>
          </ul>
        </div>

        <div style="display:flex; flex-direction: column; gap: 0.75rem; margin-top: var(--space-4); max-width: 340px;">
          {action_html}
        </div>
      </div>
    </div>
  </div>
</section>

<!-- CART MODAL -->
<div data-cart-modal class="cart-modal" style="display:none;">
  <div class="cart-modal__content">
    <div class="cart-modal__header">
      <h2 class="h-heading" style="margin:0;">Your Cart</h2>
      <button data-cart-close class="cart-modal__close">×</button>
    </div>

    <div class="cart-modal__body">
    <div data-cart-items style="display:none;"></div>
    <div data-cart-empty style="text-align:center; padding: 2rem 0;">
      <p class="body-base" style="color: var(--color-structural);">Your cart is empty.</p>
    </div>
    </div>

    <div data-cart-checkout class="cart-modal__footer" style="display:none; flex-direction:column; gap: 1rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <p class="h-heading" style="margin:0;">Subtotal</p>
        <p class="h-heading" style="margin:0;" data-cart-total>RM 0.00</p>
      </div>
      <button data-cart-whatsapp class="btn btn-primary" style="width:100%;">Proceed to Checkout &rarr;</button>
      <button type="button" data-cart-continue class="cart-modal__continue">Continue Shopping</button>
    </div>
  </div>
</div>

<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <div>
        <div class="h-heading" style="color: var(--color-bone); margin-bottom: var(--space-2);">AZAM REKA</div>
        <p class="body-sm" style="color: var(--color-structural); max-width: 34ch;">
          Custom laser-cutting and engraving, crafted with passion, precision, and a touch of artistry.
        </p>
      </div>
      <div>
        <p class="mono-label" style="color: var(--color-bone); margin-bottom: var(--space-2);">Catalogue</p>
        <a href="../catalog.html?category=plaques">Plaques &amp; Awards</a>
        <a href="../catalog.html?category=keychains">Keychains &amp; Accessories</a>
        <a href="../catalog.html?category=wedding">Wedding &amp; Mas Kahwin</a>
        <a href="../catalog.html?category=decor">Home D&eacute;cor</a>
      </div>
      <div>
        <p class="mono-label" style="color: var(--color-bone); margin-bottom: var(--space-2);">Reach Us</p>
        <a href="https://wa.me/601110852324">WhatsApp</a>
        <a href="https://instagram.com/azam.reka">Instagram @azam.reka</a>
        <a href="mailto:azam.r3ka@gmail.com">Email</a>
      </div>
    </div>
    <div class="site-footer__bottom">
      <span>&copy; 2026 Azam Reka. All rights reserved.</span>
    </div>
    <div class="site-footer__legal">
      <a href="../privacy-policy.html">Privacy Policy</a>
      <a href="../terms.html">Terms of Service</a>
      <a href="../shipping-returns.html">Shipping &amp; Returns</a>
    </div>
  </div>
</footer>

<a href="https://wa.me/601110852324" class="whatsapp-float" aria-label="Chat on WhatsApp">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.5-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10.1 9 9.6 7.7 9.4 7.2c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3 4.8 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.2-.3-.2-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.4 5.2L2 22l4.9-1.3C8.4 21.5 10.1 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
  <span class="whatsapp-float__label">Chat with us</span>
</a>

<script src="../assets/main.js"></script>
</body>
</html>
'''


def build_detail_page(product):
    media = build_media_html(product).replace("assets/", "../assets/")
    tag_style = (' style="color: var(--color-brass); border-color: var(--color-brass-soft);"'
                 if product["category"] == "wedding" else "")
    tag = (f'<span class="product-card__tag"{tag_style}>{esc(product["tag"])}</span>'
           if product["tag"] else "")
    return PRODUCT_PAGE_TEMPLATE.format(
        name=esc(product["name"]),
        slug=product["slug"],
        description=esc(product["description"]),
        og_image=esc(product["images"][0]),
        media_html=media,
        tag_html=tag,
        price_html=price_html(product),
        action_html=build_action_html(product),
    )


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def report_price_changes(products):
    """Diff the new prices against what's currently rendered in catalog.html."""
    if not os.path.exists(CATALOG_PATH):
        return
    with open(CATALOG_PATH, encoding="utf-8") as f:
        current = f.read()
    live = dict(re.findall(r'data-add-to-cart="([^"]+)" data-price="([\d.]+)"', current))

    # A variant carts under its own name, so compare on those where they exist.
    priced = {}
    for p in products:
        if p["variants"]:
            priced.update({v["name"]: v["price"] for v in p["variants"]})
        else:
            priced[p["name"]] = p["price"]

    changes = []
    for name, new in priced.items():
        old = live.get(name)
        if old is not None and abs(float(old) - new) > 0.001:
            changes.append((name, float(old), new))
    gone = sorted(set(live) - set(priced))

    if changes:
        print("\nPrice changes (site -> Zoho):")
        for name, old, new in changes:
            print(f"  {name:<32} RM {old:>7.2f}  ->  RM {new:>7.2f}")
    if gone:
        print("\nProducts leaving the catalogue:")
        for name in gone:
            print(f"  {name}")


def sync_homepage_prices(products, dry_run=False):
    """index.html curates its own product cards by hand - keep their prices honest."""
    path = os.path.join(SITE_DIR, "index.html")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        content = f.read()

    by_name = {p["name"]: p for p in products}
    updated = []

    def replace(m):
        name, old = m.group(2), float(m.group(3))
        p = by_name.get(name)
        if not p or abs(p["price"] - old) < 0.001:
            return m.group(0)
        updated.append((name, old, p["price"]))
        return (f'<span class="mono-price">{price_html(p)}</span>\n        '
                f'<button data-add-to-cart="{esc(name)}" data-price="{p["price"]:.2f}"')

    new_content = re.sub(
        r'<span class="mono-price">(.*?)</span>\s*<button data-add-to-cart="([^"]+)" data-price="([\d.]+)"',
        replace, content, flags=re.DOTALL,
    )

    if updated:
        print("\nHomepage price updates:")
        for name, old, new in updated:
            print(f"  {name:<32} RM {old:>7.2f}  ->  RM {new:>7.2f}")
        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)


def sync_checkout_thumbnails(products, dry_run=False):
    """checkout.html shows a thumbnail per cart line - keep it pointing at real files."""
    path = os.path.join(SITE_DIR, "checkout.html")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        content = f.read()

    entries = []
    for p in products:
        thumb = p["images"][0]
        names = [v["name"] for v in p["variants"]] if p["variants"] else [p["name"]]
        entries += [f"  '{n}': '{thumb}'" for n in names]
    block = "const productImages = {\n" + ",\n".join(entries) + "\n};"

    new_content, n = re.subn(r"const productImages = \{.*?\};", block, content, flags=re.DOTALL)
    if n and new_content != content:
        print(f"\nSynced {len(products)} checkout thumbnails")
        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-fetch items from Zoho first")
    ap.add_argument("--dry-run", action="store_true", help="report changes without writing")
    args = ap.parse_args()

    zoho = fetch_zoho_items() if args.refresh else load_zoho_items()
    with open(MEDIA_PATH, encoding="utf-8") as f:
        media = json.load(f)

    products, warnings = resolve_products(media, zoho)
    if not products:
        raise SystemExit("No products resolved - refusing to wipe the catalogue.")

    report_price_changes(products)
    sync_homepage_prices(products, dry_run=args.dry_run)
    sync_checkout_thumbnails(products, dry_run=args.dry_run)

    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  ! {w}")

    if args.dry_run:
        print(f"\n[dry run] would write {len(products)} products - nothing changed.")
        return

    # catalog.html grid
    with open(CATALOG_PATH, encoding="utf-8") as f:
        content = f.read()
    pattern = re.compile(r"(<!-- PRODUCTS_START -->\n)(.*?)(\n<!-- PRODUCTS_END -->)", re.DOTALL)
    if not pattern.search(content):
        raise SystemExit("PRODUCTS_START / PRODUCTS_END markers not found in catalog.html")
    grid = "\n\n".join(build_product_card(p) for p in products)
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        f.write(pattern.sub(lambda m: m.group(1) + grid + m.group(3), content))

    # detail pages
    os.makedirs(PRODUCTS_DIR, exist_ok=True)
    for p in products:
        with open(os.path.join(PRODUCTS_DIR, f"{p['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(build_detail_page(p))

    # name -> Zoho item id map, used when creating sales orders.
    # Variants cart under their own name, so each needs its own entry.
    item_map = {}
    for p in products:
        if p["variants"]:
            for v in p["variants"]:
                item_map[v["name"]] = v["zoho_item_id"]
        elif p["zoho_item_id"]:
            item_map[p["name"]] = p["zoho_item_id"]
    os.makedirs(os.path.dirname(ITEM_MAP_PATH), exist_ok=True)
    with open(ITEM_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(item_map, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nWrote {len(products)} product cards into catalog.html")
    print(f"Wrote {len(products)} detail pages into products/")
    print(f"Wrote {len(item_map)} Zoho item mappings into api/zoho-item-map.json")
    # item_map has one entry per Zoho item, but a variant product (e.g. Penunjuk
    # Al-Quran) contributes multiple entries for one product card, so this can't
    # simply be len(products) - len(item_map) - that goes negative and is
    # meaningless. Count actual unresolved products instead.
    unlinked = sum(1 for p in products if not p["zoho_item_id"] and not p["variants"])
    if unlinked:
        print(f"  ({unlinked} product(s) still unlinked - see warnings above)")


if __name__ == "__main__":
    main()
