// api/calculate-shipping.js
// Live shipping quote from EasyParcel, limited to MelPlus (Poslaju) and J&T.

const { checkRates, SENDER_ADDRESS } = require('./_lib/easyparcel');

const MIN_DELIVERY_FEE = 10;

const productWeights = require('./product-weights.json');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, postcode, state } = req.body;

    if (!items || !postcode || !state) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let totalWeight = 0;
    for (const item of items) {
      const itemWeight = productWeights[item.name] || 30; // Default 30g if not found
      totalWeight += itemWeight * item.qty;
    }
    const weightKg = Math.max(totalWeight / 1000, 0.1); // EasyParcel rejects a 0kg parcel

    let rates;
    try {
      rates = await checkRates({
        pickCode: SENDER_ADDRESS.postcode,
        pickState: SENDER_ADDRESS.state,
        sendCode: postcode,
        sendState: state,
        weight: weightKg
      });
    } catch (rateError) {
      console.error('EasyParcel rate check failed:', rateError);
      // Fall back to the minimum fee rather than blocking checkout entirely —
      // the admin still books manually via EasyParcel's own site if this happens.
      return res.status(200).json({
        success: true,
        weight: totalWeight,
        shippingCost: MIN_DELIVERY_FEE,
        minFee: MIN_DELIVERY_FEE,
        courier: null,
        degraded: true
      });
    }

    if (rates.length === 0) {
      return res.status(200).json({
        success: true,
        weight: totalWeight,
        shippingCost: MIN_DELIVERY_FEE,
        minFee: MIN_DELIVERY_FEE,
        courier: null,
        degraded: true
      });
    }

    const cheapest = rates[0];
    const shippingCost = Math.max(cheapest.price, MIN_DELIVERY_FEE);

    return res.status(200).json({
      success: true,
      weight: totalWeight,
      shippingCost,
      minFee: MIN_DELIVERY_FEE,
      courier: cheapest.courier,
      courierName: cheapest.courierName,
      serviceId: cheapest.serviceId,
      serviceName: cheapest.serviceName,
      delivery: cheapest.delivery
    });
  } catch (error) {
    console.error('Calculate shipping error:', error);
    return res.status(500).json({
      error: 'Failed to calculate shipping',
      shippingCost: MIN_DELIVERY_FEE
    });
  }
};
