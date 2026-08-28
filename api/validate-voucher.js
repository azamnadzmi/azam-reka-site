// api/validate-voucher.js
// Validates voucher codes and applies discount

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, orderTotal } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Voucher code is required' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const vouchers = db.collection('vouchers');

    // Find voucher
    const voucher = await vouchers.findOne({ code: code.toUpperCase().trim() });

    if (!voucher) {
      return res.status(404).json({ error: 'Voucher code not found' });
    }

    // Check if active
    if (!voucher.active) {
      return res.status(400).json({ error: 'Voucher code is no longer active' });
    }

    // Check expiration
    if (voucher.expiresAt && new Date() > voucher.expiresAt) {
      return res.status(400).json({ error: 'Voucher code has expired' });
    }

    // Check usage limit
    if (voucher.maxUses && voucher.currentUses >= voucher.maxUses) {
      return res.status(400).json({ error: 'Voucher code has reached its usage limit' });
    }

    // Check minimum order value
    if (voucher.minOrderValue && orderTotal < voucher.minOrderValue) {
      return res.status(400).json({
        error: `Minimum order value of RM${voucher.minOrderValue.toFixed(2)} required`,
        required: voucher.minOrderValue,
        current: orderTotal
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (voucher.discountType === 'fixed') {
      discountAmount = voucher.discountValue;
    } else if (voucher.discountType === 'percentage') {
      discountAmount = (orderTotal * voucher.discountValue) / 100;
    }

    // Ensure discount doesn't exceed order total
    discountAmount = Math.min(discountAmount, orderTotal);

    return res.status(200).json({
      valid: true,
      voucherId: voucher._id,
      code: voucher.code,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalTotal: parseFloat((orderTotal - discountAmount).toFixed(2))
    });
  } catch (error) {
    console.error('Voucher validation error:', error);
    return res.status(500).json({ error: error.message || 'Validation failed' });
  }
};
