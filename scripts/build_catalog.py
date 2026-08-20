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

def build_media_html(product, indent="        "):
    """Carousel with the video first (when present), then images in listed order."""
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
          {sale_badge}{inner}
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
          {sale_badge}<div class="carousel-track">
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


def build_add_button(product):
    first = product["variants"][0] if product["variants"] else None
    name = first["name"] if first else product["name"]
    price = first["price"] if first else product["price"]
    return (f'<button data-add-to-cart="{esc(name)}" data-price="{price:.2f}" '
            f'class="btn btn-whatsapp" style="margin-top: 0.5rem;">Add to Cart</button>')


def build_product_card(product):
    tag = f'<span class="product-card__tag">{esc(product["tag"])}</span>\n        '
    return f'''      <div class="product-card" data-category="{esc(product["category"])}" data-collection="{esc(product["tag"])}">
        <a href="products/{product["slug"]}.html" style="display:block;">
          {build_media_html(product)}
        </a>
        {tag}<a href="products/{product["slug"]}.html" style="text-decoration:none; color:inherit;"><span class="product-card__title">{esc(product["name"])}</span></a>
        <span class="mono-price">{price_html(product)}</span>{build_variant_picker(product, hidden=True)}
        {build_add_button(product)}
      </div>'''


def load_page_template():
    """Reuse the detail-page shell already used by the site."""
    from generate_catalog import PRODUCT_PAGE_TEMPLATE
    return PRODUCT_PAGE_TEMPLATE


def build_detail_page(product, template):
    media = build_media_html(product).replace("assets/", "../assets/")
    tag_style = (' style="color: var(--color-brass); border-color: var(--color-brass-soft);"'
                 if product["category"] == "wedding" else "")
    tag = (f'<span class="product-card__tag"{tag_style}>{esc(product["tag"])}</span>'
           if product["tag"] else "")
    page = template.format(
        name=esc(product["name"]),
        name_attr=esc(product["name"]),
        name_url=urllib.parse.quote(product["name"]),
        description=esc(product["description"]),
        media_html=media,
        tag_html=tag,
        price_html=price_html(product),
        cart_price=product["price"],
    )
    if product["variants"]:
        picker = build_variant_picker(product, indent="          ").lstrip("\n")
        page = page.replace(
            f'<button data-add-to-cart="{esc(product["name"])}" data-price="{product["price"]:.2f}"',
            picker + "\n          " + build_add_button(product).replace(
                ' class="btn btn-whatsapp" style="margin-top: 0.5rem;">Add to Cart</button>', ""),
            1,
        )
    return page


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
    sys.path.insert(0, SCRIPTS_DIR)
    template = load_page_template()
    os.makedirs(PRODUCTS_DIR, exist_ok=True)
    for p in products:
        with open(os.path.join(PRODUCTS_DIR, f"{p['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(build_detail_page(p, template))

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
