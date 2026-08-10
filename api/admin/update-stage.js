// api/admin/update-stage.js
// Protected — updates an order's productionStage, then emails the customer
// an update via Resend. Auth via ADMIN_PASSWORD sent in the request body
// (not query, since this is a POST that changes data).
//
// For Shipped orders booked through EasyParcel, use book-shipment.js instead —
// it gets a real tracking number from the courier and calls this same email.
// This endpoint's trackingNumber/courier fields are for manual entry (a
// courier booked outside EasyParcel).

const { MongoClient } = require('mongodb');
const { VALID_STAGES, COURIER_LABELS, sendStageUpdateEmail } = require('../_lib/order-emails');

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
    const { password, billCode, stage, trackingNumber, courier } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!billCode || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: 'Invalid billCode or stage' });
    }

    if (courier && !COURIER_LABELS[courier]) {
      return res.status(400).json({ error: 'Invalid courier' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const update = { productionStage: stage, stageUpdatedAt: new Date() };
    // Only persist courier/tracking on Shipped — the dropdown always carries a
    // default courier value, and we don't want that written onto orders that
    // aren't shipped yet just because the admin touched an unrelated stage.
    if (stage === 'shipped') {
      if (typeof trackingNumber === 'string') update.trackingNumber = trackingNumber.trim();
      if (typeof courier === 'string' && courier) update.courier = courier;
    }

    const result = await orders.findOneAndUpdate(
      { billCode },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await sendStageUpdateEmail(result.value, stage);

    return res.status(200).json({ success: true, order: result.value });
  } catch (error) {
    console.error('Update stage error:', error);
    return res.status(500).json({ error: 'Failed to update order stage' });
  }
}
