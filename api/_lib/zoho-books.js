// api/_lib/zoho-books.js
// Shared helper for creating Contacts + Sales Orders in Zoho Books via direct
// REST API calls (not the MCP protocol — this runs in the deployed backend,
// independent of any chat session).

const fs = require('fs');
const path = require('path');

const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;

let itemMapCache = null;
function loadItemMap() {
  if (itemMapCache) return itemMapCache;
  try {
    const mapPath = path.join(process.cwd(), 'api', 'zoho-item-map.json');
    itemMapCache = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  } catch (error) {
    console.error('Could not load zoho-item-map.json:', error);
    itemMapCache = {};
  }
  return itemMapCache;
}

async function getAccessToken() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured');
  }
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

async function findOrCreateContact(accessToken, order) {
  // Search by phone first — email is optional for customers, phone is always collected
  const searchResult = await zohoFetch(
    accessToken,
    `/contacts?phone=${encodeURIComponent(order.customerPhone)}`
  );

  if (searchResult.contacts && searchResult.contacts.length > 0) {
    return searchResult.contacts[0].contact_id;
  }

  // No existing contact — create one
  const createResult = await zohoFetch(accessToken, '/contacts', {
    method: 'POST',
    body: JSON.stringify({
      contact_name: order.customerName,
      contact_persons: [{
        first_name: order.customerName,
        email: order.customerEmail,
        phone: order.customerPhone,
        is_primary_contact: true
      }],
      billing_address: {
        address: order.customerAddress
      }
    })
  });

  return createResult.contact.contact_id;
}

async function createSalesOrder(order) {
  const accessToken = await getAccessToken();
  const itemMap = loadItemMap();

  const contactId = await findOrCreateContact(accessToken, order);

  const lineItems = [];
  const unmapped = [];

  for (const item of order.items) {
    const zohoItemId = itemMap[item.name];
    if (zohoItemId) {
      lineItems.push({
        item_id: zohoItemId,
        quantity: item.qty,
        rate: item.price
      });
    } else {
      // No mapping exists — add as a description-only line so nothing silently
      // disappears from the order, but flag it for manual review in Zoho.
      lineItems.push({
        name: `${item.name} (⚠ unmapped — please link to a Zoho item)`,
        quantity: item.qty,
        rate: item.price
      });
      unmapped.push(item.name);
    }
  }

  const salesOrderResult = await zohoFetch(accessToken, '/salesorders', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: contactId,
      reference_number: order.billCode,
      line_items: lineItems,
      notes: `Order placed via website. Order ID: ${order.billCode}`
    })
  });

  return {
    salesOrderId: salesOrderResult.salesorder.salesorder_id,
    salesOrderNumber: salesOrderResult.salesorder.salesorder_number,
    unmappedItems: unmapped
  };
}

module.exports = { createSalesOrder };
