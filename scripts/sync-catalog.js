#!/usr/bin/env node
// scripts/sync-catalog.js
// Syncs product catalog from Zoho Books + Google Sheets images

const fs = require('fs');
const path = require('path');

const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;

// Google Sheets CSV export URL
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS5Z_plIw2FgaazZxKtzxJvFPb9452kbi8EyCZfa0OgnS1SJBZllaSYobiPEmwHTB8bEkrBTNMsxrEe/pub?gid=1507006951&single=true&output=csv';

// Category mapping
const CATEGORY_MAP = {
  'plaques': 'plaques',
  'keychains': 'keychains',
  'wedding': 'wedding',
  'decor': 'decor'
};

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: 'POST',
    body: params
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Failed to get Zoho access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function zohoFetch(accessToken, endpoint, options = {}) {
  const url = `${ZOHO_API_DOMAIN}/books/v3${endpoint}${endpoint.includes('?') ? '&' : '?'}organization_id=${ZOHO_ORGANIZATION_ID}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (data.code && data.code !== 0) {
    throw new Error(`Zoho Books API error: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function fetchZohoItems(accessToken) {
  console.log('📦 Fetching items from Zoho Books...');
  const items = [];
  let page = 1;

  while (true) {
    const result = await zohoFetch(accessToken, `/items?page=${page}&per_page=100&filter_by=Status.Active`);
    if (!result.items || result.items.length === 0) break;

    items.push(...result.items);
    page++;
  }

  console.log(`✅ Fetched ${items.length} items from Zoho`);
  return items;
}

async function fetchGoogleSheet() {
  console.log('📄 Fetching Google Sheet CSV...');
  const response = await fetch(CSV_URL);
  const csv = await response.text();

  // Parse CSV
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    if (row['sku']) data.push(row);
  }

  console.log(`✅ Fetched ${data.length} products from Google Sheet`);
  return data;
}

function matchProducts(zohoItems, sheetData) {
  console.log('🔗 Matching products...');

  const productMap = new Map();

  for (const zohoItem of zohoItems) {
    const sku = zohoItem.sku || zohoItem.name;

    // Find matching row in Google Sheet
    const sheetRow = sheetData.find(row =>
      row['sku']?.toLowerCase() === sku.toLowerCase() ||
      row['product name']?.toLowerCase() === zohoItem.name.toLowerCase()
    );

    const category = sheetRow?.['category'] || 'decor';
    const imageUrl = sheetRow?.['image'] || '';
    const collectionTag = sheetRow?.['collection tag'] || '';

    productMap.set(sku, {
      name: zohoItem.name,
      sku,
      price: zohoItem.selling_price || 0,
      description: zohoItem.description || '',
      category: CATEGORY_MAP[category.toLowerCase()] || 'decor',
      imageUrl,
      collectionTag,
      active: zohoItem.status === 'active'
    });
  }

  return Array.from(productMap.values()).filter(p => p.active);
}

async function downloadImage(imageUrl, filename) {
  if (!imageUrl || imageUrl.includes('.jpg') === false && imageUrl.includes('.png') === false && !imageUrl.includes('photos.app.goo.gl')) {
    return null;
  }

  try {
    const response = await fetch(imageUrl, { redirect: 'follow' });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const assetDir = path.join(__dirname, '../public/assets/products');

    if (!fs.existsSync(assetDir)) {
      fs.mkdirSync(assetDir, { recursive: true });
    }

    const filepath = path.join(assetDir, filename);
    fs.writeFileSync(filepath, Buffer.from(buffer));

    return `/assets/products/${filename}`;
  } catch (error) {
    console.warn(`⚠️  Failed to download ${imageUrl}: ${error.message}`);
    return imageUrl; // Fall back to original URL
  }
}

function generateCatalogHTML(products) {
  console.log('🎨 Generating catalog HTML...');

  let html = '';

  for (const product of products) {
    const imageUrl = product.imageUrl || 'https://images.unsplash.com/photo-1595079676339-1534801ad6cf?w=700&q=80';
    const tagHtml = product.collectionTag
      ? `<span class="product-card__tag">${product.collectionTag}</span>`
      : '';

    html += `
      <div class="product-card" data-category="${product.category}">
        <div class="product-card__media kerf-card">
          <img src="${imageUrl}" alt="${product.name}" loading="lazy">
        </div>
        ${tagHtml}
        <span class="product-card__title">${product.name}</span>
        <span class="mono-price">RM ${product.price.toFixed(2)}</span>
        <button data-add-to-cart="${product.name}" data-price="${product.price.toFixed(2)}" class="btn btn-whatsapp" style="margin-top: 0.5rem;">Add to Cart</button>
      </div>
`;
  }

  return html;
}

async function updateCatalogHTML(productsHTML) {
  console.log('💾 Updating catalog.html...');

  const catalogPath = path.join(__dirname, '../catalog.html');
  let content = fs.readFileSync(catalogPath, 'utf-8');

  // Replace products between markers
  const startMarker = '<!-- PRODUCTS_START -->';
  const endMarker = '<!-- PRODUCTS_END -->';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not find PRODUCTS_START and PRODUCTS_END markers in catalog.html');
  }

  const beforeProducts = content.substring(0, startIdx + startMarker.length);
  const afterProducts = content.substring(endIdx);

  const updatedContent = beforeProducts + '\n' + productsHTML + '\n    ' + afterProducts;

  fs.writeFileSync(catalogPath, updatedContent);
  console.log('✅ Updated catalog.html');
}

async function main() {
  try {
    console.log('🚀 Starting catalog sync...\n');

    // Validate environment
    if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORGANIZATION_ID) {
      throw new Error('Missing Zoho credentials in environment variables');
    }

    // Fetch data
    const accessToken = await getAccessToken();
    const zohoItems = await fetchZohoItems(accessToken);
    const sheetData = await fetchGoogleSheet();

    // Match and generate
    const products = matchProducts(zohoItems, sheetData);
    console.log(`✅ Matched ${products.length} products`);

    const catalogHTML = generateCatalogHTML(products);
    await updateCatalogHTML(catalogHTML);

    console.log('\n✨ Catalog sync complete!');
    console.log(`📊 Generated ${products.length} product cards`);

  } catch (error) {
    console.error('❌ Error during sync:', error.message);
    process.exit(1);
  }
}

main();
