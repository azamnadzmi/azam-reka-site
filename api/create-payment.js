// api/create-payment.js
// Handles: Save order to MongoDB + create ToyyibPay bill

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI?.trim();
const toyyibPayApiKey = process.env.TOYYIBPAY_API_KEY;
const toyyibPayCategoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;

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

async function createToyyibPayBill(orderData) {
  // Validate credentials first
  if (!toyyibPayApiKey || !toyyibPayCategoryCode) {
    throw new Error('ToyyibPay credentials not configured (TOYYIBPAY_API_KEY or TOYYIBPAY_CATEGORY_CODE missing)');
  }

  const billParams = new URLSearchParams();
  billParams.append('apikey', toyyibPayApiKey);
  billParams.append('categoryCode', toyyibPayCategoryCode);
  billParams.append('billName', `Order from ${orderData.name}`);
  billParams.append('billDescription', `${orderData.items.length} item(s)`);
  billParams.append('billPriceSetting', 1); // Fixed amount
  billParams.append('billAmount', Math.round(orderData.total * 100)); // in sen
  const siteUrl = process.env.SITE_URL || 'https://azamreka.com';
  billParams.append('billReturnUrl', `${siteUrl}/order-confirmation`);
  billParams.append('billCallbackUrl', `${siteUrl}/api/webhook/toyyibpay`);
  billParams.append('billExpiryDate', new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0]);
  billParams.append('billContentEmail', orderData.email);
  billParams.append('billContentPhone', orderData.phone);
  billParams.append('billPaidNotification', 1);
  billParams.append('billSendSMS', 0);
  billParams.append('billSendEmail', 1);

  try {
    const response = await fetch('https://toyyibpay.com/api/bill/create', {
      method: 'POST',
      body: billParams,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Check if response is valid JSON before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('ToyyibPay returned non-JSON response:', text.substring(0, 500));
      throw new Error(`ToyyibPay API error: received ${contentType || 'unknown'} instead of JSON. Status: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 200) {
      throw new Error(`ToyyibPay error (status ${data.status}): ${data.message || 'Unknown error'}`);
    }

    if (!data.data || !data.data.billCode) {
      throw new Error('ToyyibPay returned invalid response: missing billCode');
    }

    return data.data.billCode;
  } catch (error) {
    // Add more context to error message
    if (error.message.includes('Unexpected token')) {
      throw new Error('ToyyibPay API authentication failed or returned invalid response. Check: API key, category code, network connectivity');
    }
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, address, notes, items, total } = req.body;

    // Validate
    if (!name || !email || !phone || !address || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create ToyyibPay bill first
    const billCode = await createToyyibPayBill({ name, email, phone, address, notes, items, total });

    // Save order to MongoDB
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const order = {
      billCode,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      customerAddress: address,
      notes: notes || '',
      items: items.map(item => ({
        name: item.name,
        price: item.price,
        qty: item.qty,
        note: item.note || ''
      })),
      totalAmount: total,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await orders.insertOne(order);

    return res.status(200).json({
      success: true,
      orderId: result.insertedId,
      billCode,
      paymentUrl: `https://toyyibpay.com/bill/${billCode}`
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    return res.status(500).json({ error: error.message || 'Payment setup failed' });
  }
}
