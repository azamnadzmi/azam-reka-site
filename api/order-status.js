// api/order-status.js
// Public endpoint — customer looks up their order by billCode alone.
// billCode is a Billplz-generated random hex ID (e.g. "061ccc797af20366"),
// not a small sequential number, so it's already an unguessable secret —
// requiring a second factor (phone) was mostly just login friction, and
// phone-number format mismatches were making it hard for real customers
// to look up their own orders.

const { MongoClient } = require('mongodb');
const { trackParcel } = require('./_lib/easyparcel');
const { STAGE_LABELS, normalizeStage } = require('./_lib/order-emails');

const mongoUri = process.env.MONGODB_URI;
let cachedClient = null;

const COURIER_LABELS = { MELPLUS: 'MelPlus (Poslaju)', JNT: 'J&T Express' };

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

/* Updated 6-stage pipeline */
const STAGE_ORDER = ['confirmed', 'design', 'approved_queued', 'cutting_engraving', 'finishing_qc', 'shipped'];
const STAGE_DESCRIPTIONS = {
  confirmed: 'We have registered your specifications. Pre-production review of coordinates is commencing.',
  design: 'Our workshop designer is preparing a high-fidelity vector layout for your approval in the message portal.',
  approved_queued: 'Your design is approved and queued for production.',
  cutting_engraving: 'The laser head is actively slicing and engraving your custom piece.',
  finishing_qc: 'Hand-sanding wooden fibers, cleaning edges, and sealing with organic mineral oil, then inspecting alignment and tolerances.',
  shipped: 'Crafted piece handed over to our logistics partner. Track delivery via the courier waybill below.'
};

// Review submission is folded into this endpoint (POST) rather than a
// separate function, to stay within Vercel Hobby's 12-function cap —
// same pattern api/messages.js already uses for GET+POST.
async function handleReviewSubmit(req, res) {
  const { billCode, rating, review } = req.body || {};
  if (!billCode) return res.status(400).json({ error: 'Order ID is required' });

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }

  const client = await getMongoClient();
  const db = client.db('azamreka');
  const orders = db.collection('orders');

  const order = await orders.findOne({ billCode: billCode.trim() });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  await orders.updateOne(
    { billCode: billCode.trim() },
    { $set: { customerRating: ratingNum, customerReview: String(review || '').trim().substring(0, 2000), reviewedAt: new Date() } }
  );

  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      return await handleReviewSubmit(req, res);
    } catch (error) {
      console.error('Review submission error:', error);
      return res.status(500).json({ error: 'Something went wrong submitting your review. Please try again.' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { billCode } = req.query;

    if (!billCode) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const order = await orders.findOne({ billCode: billCode.trim() });

    if (!order) {
      return res.status(404).json({ error: 'We could not find an order matching that Order ID. Double-check it and try again.' });
    }

    if (order.status !== 'paid') {
      return res.status(200).json({
        billCode: order.billCode,
        status: order.status,
        stage: null,
        message: 'This order is awaiting payment confirmation.'
      });
    }

    /* Normalize old stage names (cutting → cutting_engraving, etc.) for display */
    const stage = normalizeStage(order.productionStage || 'confirmed');
    const stageIndex = STAGE_ORDER.indexOf(stage);

    let tracking = null;
    if (order.trackingNumber) {
      tracking = {
        courier: order.courier,
        courierLabel: COURIER_LABELS[order.courier] || order.courier,
        trackingNumber: order.trackingNumber,
        live: null
      };
      // Best-effort — a customer refreshing this page shouldn't see a 500
      // just because EasyParcel's tracking endpoint is slow or unreachable.
      try {
        tracking.live = await trackParcel(order.trackingNumber);
      } catch (trackError) {
        console.error(`Live tracking lookup failed for ${order.billCode}:`, trackError);
      }
    }

    return res.status(200).json({
      billCode: order.billCode,
      customerName: order.customerName,
      items: order.items,
      totalAmount: order.totalAmount,
      status: order.status,
      stage,
      stageLabel: STAGE_LABELS[stage] || stage,
      stageIndex,
      stages: STAGE_ORDER.map((s, i) => ({
        key: s,
        label: STAGE_LABELS[s],
        description: STAGE_DESCRIPTIONS[s],
        completed: i <= stageIndex
      })),
      tracking,
      createdAt: order.createdAt,
      stageUpdatedAt: order.stageUpdatedAt || order.paidAt,
      messages: order.messages || [],
      customerRating: order.customerRating || null,
      customerReview: order.customerReview || null
    });
  } catch (error) {
    console.error('Order status lookup error:', error);
    return res.status(500).json({ error: 'Something went wrong looking up your order. Please try again or WhatsApp us.' });
  }
}
