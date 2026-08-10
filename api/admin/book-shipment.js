// api/admin/book-shipment.js
// Protected — books a real shipment with EasyParcel (MelPlus or J&T only),
// pays for it immediately, and saves the resulting tracking number + label
// onto the order. This spends real EasyParcel wallet credit — only call it
// when the piece is actually ready to ship.
//
// bookShipment()'s request field names (in api/_lib/easyparcel.js) are NOT
// verified against a real response — see that file's header. checkRates()
// (the rate lookup just above it in this file) IS verified. Test this on one
// low-value order before trusting it for real customer shipments.

const { MongoClient } = require('mongodb');
const { checkRates, bookShipment, SENDER_ADDRESS, ALLOWED_COURIERS } = require('../_lib/easyparcel');
const { sendStageUpdateEmail } = require('../_lib/order-emails');
const productWeights = require('../product-weights.json');

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

function computeWeightKg(items) {
  let grams = 0;
  for (const item of items) {
    grams += (productWeights[item.name] || 30) * item.qty;
  }
  return Math.max(grams / 1000, 0.1);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, billCode, preferCourier } = req.body;

    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!billCode) {
      return res.status(400).json({ error: 'billCode is required' });
    }
    if (preferCourier && !ALLOWED_COURIERS.includes(preferCourier)) {
      return res.status(400).json({ error: `preferCourier must be one of ${ALLOWED_COURIERS.join(', ')}` });
    }

    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const order = await orders.findOne({ billCode });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.trackingNumber) {
      return res.status(409).json({ error: `Already booked — tracking number ${order.trackingNumber} exists. Cancel/refund via EasyParcel directly if this was a mistake.` });
    }
    const addr = order.shippingAddress;
    if (!addr || !addr.address1 || !addr.city || !addr.state || !addr.postcode) {
      return res.status(400).json({ error: 'Order has no structured shipping address on file — this order predates the EasyParcel integration or was entered manually. Book it directly on EasyParcel\'s site and enter the tracking number by hand instead.' });
    }

    const weightKg = computeWeightKg(order.items);

    // Re-quote at booking time rather than trusting whatever price the
    // customer saw at checkout — the fastest way to get a fresh, valid
    // service_id, and protects against a stale/expired quote.
    const rates = await checkRates({
      pickCode: SENDER_ADDRESS.postcode,
      pickState: SENDER_ADDRESS.state,
      sendCode: addr.postcode,
      sendState: addr.state,
      weight: weightKg
    });

    const candidates = preferCourier ? rates.filter(r => r.courier === preferCourier) : rates;
    if (candidates.length === 0) {
      return res.status(422).json({
        error: preferCourier
          ? `No ${preferCourier} rate available for this address right now.`
          : 'No MelPlus or J&T rate available for this address right now.'
      });
    }
    const chosen = candidates[0]; // cheapest

    const itemsSummary = order.items.map(i => `${i.name} x${i.qty}`).join(', ').slice(0, 35) || 'Custom laser-cut item';

    const booking = await bookShipment({
      sender: SENDER_ADDRESS,
      receiver: {
        name: order.customerName,
        contact: order.customerPhone,
        email: order.customerEmail,
        addr1: addr.address1,
        addr2: addr.address2 || '',
        city: addr.city,
        state: addr.state,
        postcode: addr.postcode
      },
      parcel: {
        weight: weightKg,
        content: itemsSummary,
        value: order.totalAmount
      },
      serviceId: chosen.serviceId,
      dateColl: new Date().toISOString().split('T')[0]
    });

    const update = {
      productionStage: 'shipped',
      stageUpdatedAt: new Date(),
      trackingNumber: booking.trackingNumber,
      courier: chosen.courier,
      easyparcelOrderNo: booking.orderNo,
      easyparcelLabelUrl: booking.labelUrl,
      easyparcelPrice: booking.price
    };

    const result = await orders.findOneAndUpdate(
      { billCode },
      { $set: update },
      { returnDocument: 'after' }
    );

    await sendStageUpdateEmail(result.value, 'shipped');

    return res.status(200).json({
      success: true,
      order: result.value,
      booking
    });
  } catch (error) {
    console.error('Book shipment error:', error);
    return res.status(500).json({ error: error.message || 'Failed to book shipment' });
  }
}
