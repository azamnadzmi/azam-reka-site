// api/admin/list-vouchers.js
// Lists all voucher codes with usage statistics

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI;

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // In production, add authentication check here
    const authHeader = req.headers.authorization;
    if (!authHeader || !process.env.ADMIN_API_KEY || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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

    return res.status(200).json({
      success: true,
      total: vouchersList.length,
      active: vouchersList.filter(v => v.active).length,
      vouchers: vouchersList
    });
  } catch (error) {
    console.error('List vouchers error:', error);
    return res.status(500).json({ error: error.message || 'Failed to list vouchers' });
  }
};
