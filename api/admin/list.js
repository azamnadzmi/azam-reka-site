// api/admin/list.js
// Unified admin listing endpoint: orders, vouchers, etc.
// Query: ?type=orders or ?type=vouchers (default: orders)

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI;

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

async function authenticateAdmin(req) {
  const authHeader = req.headers.authorization;
  return authHeader && process.env.ADMIN_API_KEY && authHeader === `Bearer ${process.env.ADMIN_API_KEY}`;
}

async function listOrders() {
  const client = await getMongoClient();
  const db = client.db('azamreka');
  const orders = db.collection('orders');

  const allOrders = await orders
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  return {
    success: true,
    type: 'orders',
    total: allOrders.length,
    orders: allOrders
  };
}

async function listVouchers() {
  const client = await getMongoClient();
  const db = client.db('azamreka');
  const vouchers = db.collection('vouchers');

  const allVouchers = await vouchers
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const vouchersList = allVouchers.map(v => ({
    _id: v._id,
    code: v.code,
    discountValue: v.discountValue,
    discountType: v.discountType,
    active: v.active,
    maxUses: v.maxUses,
    currentUses: v.currentUses,
    usageRemaining: v.maxUses ? v.maxUses - v.currentUses : 'unlimited',
    minOrderValue: v.minOrderValue,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    appliedOrders: v.appliedOrders?.length || 0
  }));

  return {
    success: true,
    type: 'vouchers',
    total: vouchersList.length,
    active: vouchersList.filter(v => v.active).length,
    vouchers: vouchersList
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const isAuthenticated = await authenticateAdmin(req);
    if (!isAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const type = req.query.type || 'orders';

    if (type === 'orders') {
      const result = await listOrders();
      return res.status(200).json(result);
    }

    if (type === 'vouchers') {
      const result = await listVouchers();
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid type. Use type=orders or type=vouchers' });
  } catch (error) {
    console.error('List endpoint error:', error);
    return res.status(500).json({ error: error.message || 'Failed to list items' });
  }
};
