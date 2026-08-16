// api/calculate-shipping.js
// Live shipping quote from EasyParcel, limited to MelPlus (Poslaju) and J&T.

const { checkRates, debugRawRates, SENDER_ADDRESS } = require('./_lib/easyparcel');

const MIN_DELIVERY_FEE = 10;

const productWeights = require('./product-weights.json');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, postcode, state, debug } = req.body;

    if (!items || !postcode || !state) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // TEMPORARY diagnostic path — remove once live EasyParcel rates are
    // confirmed working. Returns the raw, unfiltered EasyParcel response so
    // we can see the real error or the real courier/service names instead
    // of guessing. Not a secret-exposure risk (no credentials in the output).
    if (debug === 'azamreka-debug') {
      try {
        const raw = await debugRawRates({
          pickCode: SENDER_ADDRESS.postcode,
          pickState: SENDER_ADDRESS.state,
          sendCode: postcode,
          sendState: state,
          weight: 0.5
        });
        return res.status(200).json({ debug: true, raw });
      } catch (debugError) {
        return res.status(200).json({ debug: true, error: debugError.message });
      }
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

    // Return every matched courier (PosLaju/MelPlus and J&T) so the customer
    // can pick, not just whichever is cheapest — checkout.html renders these
    // as selectable options and defaults to the first (cheapest, since
    // checkRates() sorts ascending by price).
    const options = rates.map(rate => ({
      courier: rate.courier,
      courierName: rate.courierName,
      serviceId: rate.serviceId,
      serviceName: rate.serviceName,
      delivery: rate.delivery,
      cost: Math.max(rate.price, MIN_DELIVERY_FEE)
    }));

    const cheapest = options[0];

    return res.status(200).json({
      success: true,
      weight: totalWeight,
      minFee: MIN_DELIVERY_FEE,
      options,
      // Kept for backward compatibility with any caller still reading the
      // single-courier shape.
      shippingCost: cheapest.cost,
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
