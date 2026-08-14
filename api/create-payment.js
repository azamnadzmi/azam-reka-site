// api/create-payment.js
// Handles: Save order to MongoDB + create Billplz invoice

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const mongoUri = process.env.MONGODB_URI;
const billplzApiKey = process.env.BILLPLZ_API_KEY;
const billplzCollectionId = process.env.BILLPLZ_COLLECTION_ID;

console.log('ENV CHECK:', {
  hasBillplzApiKey: !!billplzApiKey,
  apiKeyLength: billplzApiKey?.length,
  hasBillplzCollectionId: !!billplzCollectionId,
  collectionId: billplzCollectionId
});

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

async function createBillplzInvoice(orderData) {
  const siteUrl = process.env.SITE_URL || 'https://azamreka.com';

  // Billplz API expects form-encoded data, not JSON
  const params = new URLSearchParams();
  params.append('collection_id', billplzCollectionId);
  params.append('email', orderData.email);
  params.append('mobile', orderData.phone);
  params.append('name', orderData.name);
  params.append('amount', Math.round(orderData.total * 100)); // in sen
  params.append('description', `Order: ${orderData.items.map(i => i.name).join(', ')}`.substring(0, 200));
  params.append('callback_url', `${siteUrl}/api/webhook/billplz`);
  params.append('redirect_url', `${siteUrl}/order-confirmation`);

  const response = await fetch('https://www.billplz.com/api/v3/bills', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(billplzApiKey + ':').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const responseText = await response.text();
  console.log('Billplz response status:', response.status);
  console.log('Billplz response body:', responseText.substring(0, 500));

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Billplz returned invalid JSON (status ${response.status}): ${responseText.substring(0, 200)}`);
  }

  if (!data.url) {
    throw new Error(`Billplz error: ${data.message || 'Failed to create bill'}`);
  }

  return { id: data.id, url: data.url };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, shippingAddress, shipping, notes, items, total } = req.body;

    // Validate
    if (!name || !email || !phone || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!shippingAddress || !shippingAddress.address1 || !shippingAddress.city ||
        !shippingAddress.state || !shippingAddress.postcode) {
      return res.status(400).json({ error: 'Missing shipping address' });
    }

    // Single-line address for Zoho / confirmation emails, built from the
    // structured fields EasyParcel needs to actually book the shipment.
    const addressLine = [
      shippingAddress.address1,
      shippingAddress.address2,
      `${shippingAddress.postcode} ${shippingAddress.city}`,
      shippingAddress.stateName || shippingAddress.state
    ].filter(Boolean).join(', ');

    // Create Billplz invoice first
    const billplz = await createBillplzInvoice({ name, email, phone, address: addressLine, notes, items, total });

    // Save order to MongoDB
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const order = {
      billplzId: billplz.id,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      customerAddress: addressLine,
      shippingAddress,
      shipping: shipping || null,
      notes: notes || '',
      items: items.map(item => ({ name: item.name, price: item.price, qty: item.qty })),
      totalAmount: total,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await orders.insertOne(order);

    return res.status(200).json({
      success: true,
      orderId: result.insertedId,
      billplzId: billplz.id,
      paymentUrl: billplz.url
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    return res.status(500).json({ error: error.message || 'Payment setup failed' });
  }
}
