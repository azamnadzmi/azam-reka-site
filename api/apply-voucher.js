// api/apply-voucher.js
// Applies voucher to an order after payment is confirmed

const { MongoClient, ObjectId } = require('mongodb');

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
    const { orderId, voucherCode } = req.body;

    if (!orderId || !voucherCode) {
      return res.status(400).json({ error: 'Order ID and voucher code required' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');
    const vouchers = db.collection('vouchers');

    // Find order
    const order = await orders.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if already applied
    if (order.voucherCode) {
      return res.status(400).json({ error: 'Voucher already applied to this order' });
    }

    // Find voucher
    const voucher = await vouchers.findOne({ code: voucherCode.toUpperCase().trim() });
    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found' });
    }

    // Check validity
    if (!voucher.active || (voucher.expiresAt && new Date() > voucher.expiresAt)) {
      return res.status(400).json({ error: 'Voucher is no longer valid' });
    }

    if (voucher.maxUses && voucher.currentUses >= voucher.maxUses) {
      return res.status(400).json({ error: 'Voucher usage limit reached' });
    }

    // Apply voucher to order
    await orders.updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          voucherCode: voucher.code,
          discountAmount: voucher.discountValue,
          updatedAt: new Date()
        }
      }
    );

    // Increment voucher usage
    await vouchers.updateOne(
      { _id: voucher._id },
      {
        $inc: { currentUses: 1 },
        $push: { appliedOrders: new ObjectId(orderId) }
      }
    );

    return res.status(200).json({
      success: true,
      orderId,
      voucherCode: voucher.code,
      discountAmount: voucher.discountValue,
      message: `RM${voucher.discountValue} discount applied`
    });
  } catch (error) {
    console.error('Apply voucher error:', error);
    return res.status(500).json({ error: error.message || 'Failed to apply voucher' });
  }
};
