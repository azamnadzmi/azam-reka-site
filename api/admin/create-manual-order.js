// api/admin/create-manual-order.js
// Admin endpoint: Create order manually (customer + products + Zoho SO)
// Used for WhatsApp/phone orders

const { MongoClient } = require('mongodb');
const { getAccessToken, findOrCreateContact, createSalesOrder } = require('../_lib/zoho-books');

const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;
const zohoClientId = process.env.ZOHO_CLIENT_ID;
const zohoClientSecret = process.env.ZOHO_CLIENT_SECRET;
const zohoRefreshToken = process.env.ZOHO_REFRESH_TOKEN;
const zohoOrgId = process.env.ZOHO_ORGANIZATION_ID;
const siteUrl = process.env.SITE_URL || 'https://azamreka.com';

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

function generateBillCode(source = 'online') {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const prefix = source === 'whatsapp' ? 'WA' : 'OR';
  return `${prefix}-${timestamp}-${random}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, customerAction, customerName, customerEmail, customerPhone, customerAddress, zohoCustomerId, items, totalAmount, notes, source } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate required fields
    if (!customerAction || !['create', 'select'].includes(customerAction)) {
      return res.status(400).json({ error: 'customerAction must be "create" or "select"' });
    }

    if (customerAction === 'create') {
      if (!customerName || !customerEmail || !customerPhone || !customerAddress) {
        return res.status(400).json({ error: 'Customer name, email, phone, and address required' });
      }
    } else if (!zohoCustomerId) {
      return res.status(400).json({ error: 'zohoCustomerId required when selecting existing customer' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one product item required' });
    }

    if (!totalAmount || totalAmount <= 0) {
      return res.status(400).json({ error: 'Invalid total amount' });
    }

    // Generate order ID
    const billCode = generateBillCode(source || 'online');

    // Check for duplicate
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const ordersCollection = db.collection('orders');

    const existing = await ordersCollection.findOne({ billCode });
    if (existing) {
      return res.status(400).json({ error: 'Order ID already exists, try again' });
    }

    // Get Zoho access token
    let accessToken;
    try {
      accessToken = await getAccessToken(zohoClientId, zohoClientSecret, zohoRefreshToken);
    } catch (error) {
      console.error('Zoho token error:', error);
      return res.status(500).json({ error: 'Failed to authenticate with Zoho' });
    }

    // Get or create customer in Zoho
    let contactId;
    let contactData = {};

    if (customerAction === 'create') {
      try {
        contactData = await findOrCreateContact(accessToken, {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
          address: customerAddress
        });
        contactId = contactData.contact_id;
      } catch (error) {
        console.error('Zoho customer creation error:', error);
        return res.status(500).json({ error: 'Failed to create customer in Zoho' });
      }
    } else {
      contactId = zohoCustomerId;
    }

    // Create Sales Order in Zoho
    let zohoResult;
    try {
      zohoResult = await createSalesOrder(accessToken, {
        billCode,
        contactId,
        items,
        notes: notes ? `Manual order. Notes: ${notes}` : 'Manual order via website'
      });
    } catch (error) {
      console.error('Zoho SO creation error:', error);
      return res.status(500).json({ error: 'Failed to create Sales Order in Zoho' });
    }

    // Save order to MongoDB
    const orderDoc = {
      billCode,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      source: source || 'online',
      items,
      totalAmount,
      notes: notes || null,
      status: 'pending',
      productionStage: 'confirmed',
      zohoSalesOrderId: zohoResult.salesOrderId,
      zohoSalesOrderNumber: zohoResult.salesOrderNumber,
      zohoUnmappedItems: zohoResult.unmappedItems || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await ordersCollection.insertOne(orderDoc);

    const trackingUrl = `${siteUrl}/track-order.html?billCode=${encodeURIComponent(billCode)}`;

    return res.status(200).json({
      success: true,
      billCode,
      zohoSalesOrderNumber: zohoResult.salesOrderNumber,
      zohoSalesOrderId: zohoResult.salesOrderId,
      customerName,
      customerPhone,
      customerEmail,
      items,
      totalAmount,
      status: 'pending',
      productionStage: 'confirmed',
      trackingUrl,
      message: `Order created! SO #${zohoResult.salesOrderNumber}. Awaiting payment confirmation.`
    });
  } catch (error) {
    console.error('Create manual order error:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}
