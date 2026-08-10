// api/admin/import-from-zoho.js
// Takes a Zoho Books Sales Order number (e.g. "SO-00012"), fetches the full
// order from Zoho, and creates a MongoDB tracking record so the customer can
// use the Order Tracking page — closing the gap for WhatsApp orders.

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;
const zohoClientId = process.env.ZOHO_CLIENT_ID;
const zohoClientSecret = process.env.ZOHO_CLIENT_SECRET;
const zohoRefreshToken = process.env.ZOHO_REFRESH_TOKEN;
const zohoOrgId = process.env.ZOHO_ORGANIZATION_ID;
const zohoAccountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com';
const zohoApiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

let cachedClient = null;
async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    retryWrites: true,
    maxPoolSize: 1
  });
  await cachedClient.connect();
  return cachedClient;
}

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: zohoRefreshToken,
    client_id: zohoClientId,
    client_secret: zohoClientSecret,
    grant_type: 'refresh_token'
  });
  const res = await fetch(`${zohoAccountsDomain}/oauth/v2/token`, {
    method: 'POST', body: params
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchSalesOrder(accessToken, soNumber) {
  // Search by salesorder_number
  const url = `${zohoApiDomain}/books/v3/salesorders?salesorder_number=${encodeURIComponent(soNumber)}&organization_id=${zohoOrgId}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
  });
  const data = await res.json();
  if (!data.salesorders || data.salesorders.length === 0) {
    throw new Error(`No Sales Order found with number "${soNumber}". Double-check the number in Zoho Books.`);
  }

  // Fetch full detail (list endpoint has limited fields)
  const soId = data.salesorders[0].salesorder_id;
  const detailRes = await fetch(`${zohoApiDomain}/books/v3/salesorders/${soId}?organization_id=${zohoOrgId}`, {
    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
  });
  const detailData = await detailRes.json();
  if (!detailData.salesorder) throw new Error('Could not fetch Sales Order detail from Zoho.');
  return detailData.salesorder;
}

// Generates a short human-readable Order ID for WhatsApp sharing, since Zoho
// SO numbers are internal and Zoho Sales Order IDs are long numeric strings.
function generateOrderId(soNumber) {
  const clean = soNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WA-${clean}-${suffix}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { password, soNumber, customerPhone } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!soNumber) {
      return res.status(400).json({ error: 'Sales Order number is required' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    // Idempotency — don't create a duplicate if this SO was already imported
    const existing = await orders.findOne({ zohoSalesOrderNumber: soNumber.trim() });
    if (existing) {
      return res.status(200).json({
        alreadyImported: true,
        billCode: existing.billCode,
        customerName: existing.customerName,
        message: `This Sales Order was already imported as Order ID: ${existing.billCode}`
      });
    }

    const accessToken = await getAccessToken();
    const so = await fetchSalesOrder(accessToken, soNumber.trim());

    const billCode = generateOrderId(soNumber.trim());

    // Map Zoho line items to our internal format
    const items = (so.line_items || []).map(li => ({
      name: li.name || li.description || 'Item',
      price: parseFloat(li.rate) || 0,
      qty: parseInt(li.quantity) || 1
    }));

    const totalAmount = parseFloat(so.total) || items.reduce((s, i) => s + i.price * i.qty, 0);

    // Use phone from request if provided (Zoho may not always have it), fall
    // back to what's on the contact
    const phone = customerPhone || so.shipping_address?.phone || so.billing_address?.phone || '';

    const order = {
      billCode,
      customerName: so.customer_name,
      customerEmail: so.email || '',
      customerPhone: phone,
      customerAddress: [
        so.shipping_address?.address,
        so.shipping_address?.city,
        so.shipping_address?.state
      ].filter(Boolean).join(', ') || '',
      notes: so.notes || '',
      items,
      totalAmount,
      status: 'paid',
      source: 'whatsapp',
      paidAt: new Date(),
      createdAt: new Date(),
      productionStage: 'confirmed',
      stageUpdatedAt: new Date(),
      zohoSalesOrderId: so.salesorder_id,
      zohoSalesOrderNumber: so.salesorder_number
    };

    await orders.insertOne(order);

    return res.status(200).json({
      success: true,
      billCode,
      customerName: so.customer_name,
      customerPhone: phone,
      items,
      totalAmount,
      zohoSalesOrderNumber: so.salesorder_number
    });
  } catch (error) {
    console.error('Import from Zoho error:', error);
    return res.status(500).json({ error: error.message || 'Import failed' });
  }
};
