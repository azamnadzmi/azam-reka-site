// api/admin/sync-catalog.js
// Endpoint to manually trigger catalog sync from Zoho + Google Sheets

const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS5Z_plIw2FgaazZxKtzxJvFPb9452kbi8EyCZfa0OgnS1SJBZllaSYobiPEmwHTB8bEkrBTNMsxrEe/pub?gid=1507006951&single=true&output=csv';

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
  const items = [];
  let page = 1;

  while (true) {
    const result = await zohoFetch(accessToken, `/items?page=${page}&per_page=100&filter_by=Status.Active`);
    if (!result.items || result.items.length === 0) break;
    items.push(...result.items);
    page++;
  }

  return items;
}

async function fetchGoogleSheet() {
  const response = await fetch(CSV_URL);
  const csv = await response.text();

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

  return data;
}

function matchProducts(zohoItems, sheetData) {
  const productMap = new Map();

  for (const zohoItem of zohoItems) {
    const sku = zohoItem.sku || zohoItem.name;

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

function generateCatalogHTML(products) {
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORGANIZATION_ID) {
      return res.status(500).json({ error: 'Missing Zoho credentials' });
    }

    // Fetch data
    const accessToken = await getAccessToken();
    const zohoItems = await fetchZohoItems(accessToken);
    const sheetData = await fetchGoogleSheet();

    // Match and generate
    const products = matchProducts(zohoItems, sheetData);
    const catalogHTML = generateCatalogHTML(products);

    return res.status(200).json({
      success: true,
      message: `Catalog synced: ${products.length} products`,
      productsCount: products.length,
      preview: catalogHTML.substring(0, 200) + '...'
    });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: error.message });
  }
};
