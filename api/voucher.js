// api/voucher.js
// Unified voucher endpoint: validate codes and apply to orders
// Handles both POST /api/voucher?action=validate and POST /api/voucher?action=apply

const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGODB_URI;

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

async function validateVoucher(code, orderTotal) {
  const client = await getMongoClient();
  const db = client.db('azamreka');
  const vouchers = db.collection('vouchers');

  const voucher = await vouchers.findOne({ code: code.toUpperCase().trim() });

  if (!voucher) {
    return { error: 'Voucher code not found', status: 404 };
  }

  if (!voucher.active) {
    return { error: 'Voucher code is no longer active', status: 400 };
  }

  if (voucher.expiresAt && new Date() > voucher.expiresAt) {
    return { error: 'Voucher code has expired', status: 400 };
  }

  if (voucher.maxUses && voucher.currentUses >= voucher.maxUses) {
    return { error: 'Voucher code has reached its usage limit', status: 400 };
  }

  if (voucher.minOrderValue && orderTotal < voucher.minOrderValue) {
    return {
      error: `Minimum order value of RM${voucher.minOrderValue.toFixed(2)} required`,
      status: 400,
      required: voucher.minOrderValue,
      current: orderTotal
    };
  }

  let discountAmount = 0;
  if (voucher.discountType === 'fixed') {
    discountAmount = voucher.discountValue;
  } else if (voucher.discountType === 'percentage') {
    discountAmount = (orderTotal * voucher.discountValue) / 100;
  }

  discountAmount = Math.min(discountAmount, orderTotal);

  return {
    valid: true,
    voucherId: voucher._id,
    code: voucher.code,
    discountType: voucher.discountType,
    discountValue: voucher.discountValue,
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    finalTotal: parseFloat((orderTotal - discountAmount).toFixed(2))
  };
}

async function applyVoucher(orderId, voucherCode) {
  const client = await getMongoClient();
  const db = client.db('azamreka');
  const orders = db.collection('orders');
  const vouchers = db.collection('vouchers');

  const order = await orders.findOne({ _id: new ObjectId(orderId) });
  if (!order) {
    return { error: 'Order not found', status: 404 };
  }

  if (order.voucherCode) {
    return { error: 'Voucher already applied to this order', status: 400 };
  }

  const voucher = await vouchers.findOne({ code: voucherCode.toUpperCase().trim() });
  if (!voucher) {
    return { error: 'Voucher not found', status: 404 };
  }

  if (!voucher.active || (voucher.expiresAt && new Date() > voucher.expiresAt)) {
    return { error: 'Voucher is no longer valid', status: 400 };
  }

  if (voucher.maxUses && voucher.currentUses >= voucher.maxUses) {
    return { error: 'Voucher usage limit reached', status: 400 };
  }

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

  await vouchers.updateOne(
    { _id: voucher._id },
    {
      $inc: { currentUses: 1 },
      $push: { appliedOrders: new ObjectId(orderId) }
    }
  );

  return {
    success: true,
    orderId,
    voucherCode: voucher.code,
    discountAmount: voucher.discountValue,
    message: `RM${voucher.discountValue} discount applied`
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const action = req.query.action || 'validate';
    const { code, orderId, orderTotal } = req.body;

    if (action === 'validate') {
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Voucher code is required' });
      }
      const result = await validateVoucher(code, orderTotal);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(200).json(result);
    }

    if (action === 'apply') {
      if (!orderId || !code) {
        return res.status(400).json({ error: 'Order ID and voucher code required' });
      }
      const result = await applyVoucher(orderId, code);
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid action. Use action=validate or action=apply' });
  } catch (error) {
    console.error('Voucher endpoint error:', error);
    return res.status(500).json({ error: error.message || 'Operation failed' });
  }
};
