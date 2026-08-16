// api/admin/list-orders.js
// Protected — returns recent paid orders for the admin dashboard.
// Auth: expects an X-Admin-Password header, checked against ADMIN_PASSWORD.
// (Not a query param — query strings get written to server access logs,
// browser history, and proxy/CDN logs in plaintext.) This is a
// single-shared-password gate, appropriate for a solo-operator business —
// not meant to scale to multiple staff accounts.

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const password = req.headers['x-admin-password'];
  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const results = await orders
      .find({ status: 'paid' })
      .sort({ paidAt: -1 })
      .limit(100)
      .toArray();

    return res.status(200).json({ orders: results });
  } catch (error) {
    console.error('Admin orders fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}
