// api/admin/update-stage.js
// Protected — updates an order's productionStage, then emails the customer
// an update via Resend. Auth via ADMIN_PASSWORD sent in the request body
// (not query, since this is a POST that changes data).

const { MongoClient } = require('mongodb');
const { Resend } = require('resend');

const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;
const resendApiKey = process.env.RESEND_API_KEY;
const siteUrl = process.env.SITE_URL || 'https://azamreka.com';

const VALID_STAGES = ['confirmed', 'design', 'cutting', 'engraving', 'finishing_qc', 'shipped'];
const STAGE_LABELS = {
  confirmed: 'Order Confirmed',
  design: 'Design Proof',
  cutting: 'Cutting',
  engraving: 'Engraving',
  finishing_qc: 'Finishing & QC',
  shipped: 'Shipped'
};
const STAGE_MESSAGES = {
  confirmed: 'We\'ve confirmed your order and are getting ready to start.',
  design: 'We\'re finalizing the design proof for your piece.',
  cutting: 'Your piece is being cut right now.',
  engraving: 'Your piece is being engraved.',
  finishing_qc: 'Your piece is being finished and quality-checked.',
  shipped: 'Your piece has shipped and is on its way to you!'
};

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

async function sendStageUpdateEmail(order, stage) {
  if (!resendApiKey || !order.customerEmail) return;
  const resend = new Resend(resendApiKey);
  const trackingUrl = `${siteUrl}/track-order.html?billCode=${encodeURIComponent(order.billCode)}`;

  const trackingSection = (stage === 'shipped' && order.trackingNumber)
    ? `<p><strong>Courier:</strong> ${order.courier || 'J&amp;T / Pos Laju'}<br>
       <strong>Tracking Number:</strong> <code>${order.trackingNumber}</code></p>`
    : '';

  try {
    await resend.emails.send({
      from: 'orders@azamreka.com',
      to: order.customerEmail,
      subject: `Order #${order.billCode} update: ${STAGE_LABELS[stage]} — Azam Reka`,
      html: `
        <h2>Your order has been updated</h2>
        <p>Hi ${order.customerName},</p>
        <p>${STAGE_MESSAGES[stage]}</p>
        <p><strong>Current stage:</strong> ${STAGE_LABELS[stage]}</p>
        ${trackingSection}
        <p><a href="${trackingUrl}">Track your order</a> for full progress details.</p>
        <p>Questions? WhatsApp us at +60 11-1085 2324.</p>
        <p>Thanks for choosing Azam Reka!</p>
      `
    });
  } catch (error) {
    console.error('Stage update email error:', error);
    // Don't fail the stage update if the email fails to send
  }
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

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const updateFields = { productionStage: stage, stageUpdatedAt: new Date() };
    if (trackingNumber) {
      updateFields.trackingNumber = trackingNumber.trim();
      updateFields.courier = (courier || '').trim();
    }

    const result = await orders.findOneAndUpdate(
      { billCode },
      { $set: updateFields },
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
