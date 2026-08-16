// api/messages.js
// Two-way message thread per order — customer <-> admin. One endpoint
// handles both directions and both GET (read thread) and POST (send),
// to stay within Vercel Hobby's 12-function cap.
//
// Auth: a request is either the admin (adminPassword) or the customer.
// Customer auth is just knowing the billCode — same as api/order-status.js,
// since billCode is a Billplz-generated random hex ID, not a guessable
// sequential number. Requiring phone too was mostly login friction.

const { MongoClient } = require('mongodb');
const { uploadImage } = require('./_lib/google-drive');

const mongoUri = process.env.MONGODB_URI;
const adminPasswordEnv = process.env.ADMIN_PASSWORD;

let cachedClient = null;
async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

/**
 * Resolves the caller's identity for a given order. Returns 'admin',
 * 'customer', or null (unauthorized). Never trusts the caller's claimed
 * role — always re-checks against the env password. The 'order' param
 * having already been found by billCode is what authorizes 'customer'.
 */
function resolveSender({ order, adminPassword }) {
  if (adminPassword && adminPasswordEnv && adminPassword === adminPasswordEnv) {
    return 'admin';
  }
  if (order) {
    return 'customer';
  }
  return null;
}

module.exports = async function handler(req, res) {
  try {
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    if (req.method === 'GET') {
      const { billCode } = req.query;
      const adminPassword = req.headers['x-admin-password'];
      if (!billCode) return res.status(400).json({ error: 'billCode is required' });

      const order = await orders.findOne({ billCode: billCode.trim() });
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const sender = resolveSender({ order, adminPassword });
      if (!sender) return res.status(403).json({ error: 'Not authorized to view this order' });

      return res.status(200).json({ messages: order.messages || [] });
    }

    if (req.method === 'POST') {
      const { billCode, adminPassword, text, imageBase64, imageMimeType } = req.body || {};
      if (!billCode) return res.status(400).json({ error: 'billCode is required' });
      if (!text && !imageBase64) return res.status(400).json({ error: 'Message text or image is required' });

      const order = await orders.findOne({ billCode: billCode.trim() });
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const sender = resolveSender({ order, adminPassword });
      if (!sender) return res.status(403).json({ error: 'Not authorized to message on this order' });

      let imageUrl = null;
      if (imageBase64) {
        if (imageBase64.length > 7_000_000) { // ~5MB raw, base64-inflated
          return res.status(400).json({ error: 'Image too large (max 5MB)' });
        }
        imageUrl = await uploadImage(imageBase64, imageMimeType || 'image/jpeg', `${billCode}-${Date.now()}.jpg`);
      }

      const message = {
        sender,
        text: text || '',
        imageUrl,
        timestamp: new Date()
      };

      await orders.updateOne(
        { billCode: billCode.trim() },
        { $push: { messages: message } }
      );

      return res.status(200).json({ success: true, message });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Messages endpoint error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
