// api/calculate-shipping.js
// Calculate shipping cost via EasyParcel based on weight and destination

const EASYPARCEL_ID = process.env.EASYPARCEL_ID;
const EASYPARCEL_KEY = process.env.EASYPARCEL_KEY;
const ORIGIN_POSTCODE = '80200';
const ORIGIN_STATE = 'Johor Bahru';
const MIN_DELIVERY_FEE = 10;

const productWeights = {
  "Plaque": 50,
  "Desk Name Plaque": 55,
  "Plaque Wood+Acrylic": 80,
  "Plaque Portrait A4": 100,
  "Personalised Bookmark": 15,
  "Bookmark": 12,
  "HG25 Keychain": 20,
  "Keychain": 18,
  "Phone Holder": 35,
  "Mas Kahwin/Hantaran Plaque": 120,
  "Rehal Lite": 150,
  "Mas Kahwin Frame 2025": 180,
  "Arah Sujud": 200,
  "Magnetic Mini Frame": 40,
  "Customized Mini Boards": 70,
  "Thank You Succulent HG25": 25
};

async function getEasyParcelRate(weight, destPostcode, destState) {
  try {
    // Format weight in kg
    const weightKg = (weight / 1000).toFixed(2);

    // Call EasyParcel API
    const response = await fetch('https://api.easyparcel.my/shipping/rate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${EASYPARCEL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pickup_postcode: ORIGIN_POSTCODE,
        pickup_state: ORIGIN_STATE,
        delivery_postcode: destPostcode,
        delivery_state: destState,
        weight: parseFloat(weightKg),
        service_type: 'standard'
      })
    });

    if (!response.ok) {
      console.error('EasyParcel API error:', response.status);
      return null;
    }

    const data = await response.json();

    // Extract shipping cost from response
    if (data.data && data.data.rates && data.data.rates.length > 0) {
      const rate = data.data.rates[0];
      const shippingCost = parseFloat(rate.total_price) || 0;
      return Math.max(shippingCost, MIN_DELIVERY_FEE);
    }

    return MIN_DELIVERY_FEE;
  } catch (error) {
    console.error('Shipping calculation error:', error);
    return MIN_DELIVERY_FEE;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, postcode, state } = req.body;

    if (!items || !postcode || !state) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate total weight from items
    let totalWeight = 0;
    for (const item of items) {
      const itemWeight = productWeights[item.name] || 30; // Default 30g if not found
      totalWeight += itemWeight * item.qty;
    }

    // Get shipping cost from EasyParcel
    const shippingCost = await getEasyParcelRate(totalWeight, postcode, state);

    return res.status(200).json({
      success: true,
      weight: totalWeight,
      shippingCost: shippingCost || MIN_DELIVERY_FEE,
      minFee: MIN_DELIVERY_FEE
    });
  } catch (error) {
    console.error('Calculate shipping error:', error);
    return res.status(500).json({
      error: 'Failed to calculate shipping',
      shippingCost: MIN_DELIVERY_FEE
    });
  }
};
