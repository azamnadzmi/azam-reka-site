// api/admin/mark-order-paid.js
// Admin marks a manually-created order as paid

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, billCode, paidAmount, paymentMethod } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!billCode) {
      return res.status(400).json({ error: 'billCode required' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    // Find the order
    const order = await orders.findOne({ billCode });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update order status
    const result = await orders.findOneAndUpdate(
      { billCode },
      {
        $set: {
          status: 'paid',
          paidAmount: paidAmount || order.totalAmount,
          paidAt: new Date(),
          paymentMethod: paymentMethod || 'manual',
          stageUpdatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    return res.status(200).json({
      success: true,
      order: result
    });
  } catch (error) {
    console.error('Mark order paid error:', error);
    return res.status(500).json({ error: 'Failed to update order payment status' });
  }
}
