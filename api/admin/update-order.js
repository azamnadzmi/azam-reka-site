// api/admin/update-order.js
// Unified admin update endpoint for orders
// Handles: mark-order-paid (?action=pay) and update-stage (?action=stage)

const { MongoClient } = require('mongodb');
const { VALID_STAGES, COURIER_LABELS, sendStageUpdateEmail, normalizeStage } = require('../_lib/order-emails');

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

async function markOrderPaid(billCode, paidAmount, paymentMethod) {
  const client = await getMongoClient();
  const db = client.db('azamreka');
  const orders = db.collection('orders');

  const order = await orders.findOne({ billCode });
  if (!order) {
    return { error: 'Order not found', status: 404 };
  }

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

  return { success: true, order: result };
}

async function updateStage(billCode, stage, trackingNumber, courier) {
  if (!VALID_STAGES.includes(stage)) {
    return { error: 'Invalid stage', status: 400 };
  }

  if (courier && !COURIER_LABELS[courier]) {
    return { error: 'Invalid courier', status: 400 };
  }

  const client = await getMongoClient();
  const db = client.db('azamreka');
  const orders = db.collection('orders');

  const update = { productionStage: stage, stageUpdatedAt: new Date() };
  if (stage === 'shipped') {
    if (typeof trackingNumber === 'string') update.trackingNumber = trackingNumber.trim();
    if (typeof courier === 'string' && courier) update.courier = courier;
  }

  const result = await orders.findOneAndUpdate(
    { billCode },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!result) {
    return { error: 'Order not found', status: 404 };
  }

  await sendStageUpdateEmail(result, stage);

  return { success: true, order: result };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const action = req.query.action || 'stage';
    const { billCode, stage, trackingNumber, courier, paidAmount, paymentMethod } = req.body;

    if (!billCode) {
      return res.status(400).json({ error: 'billCode is required' });
    }

    if (action === 'pay') {
      const result = await markOrderPaid(billCode, paidAmount, paymentMethod);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(200).json(result);
    }

    if (action === 'stage') {
      if (!stage) {
        return res.status(400).json({ error: 'stage is required' });
      }
      const result = await updateStage(billCode, stage, trackingNumber, courier);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid action. Use action=pay or action=stage' });
  } catch (error) {
    console.error('Update order error:', error);
    return res.status(500).json({ error: 'Failed to update order' });
  }
};
