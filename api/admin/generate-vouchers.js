// api/admin/generate-vouchers.js
// Generates RM20 discount voucher codes
// Usage: node api/admin/generate-vouchers.js --count 5 --value 20

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const mongoUri = process.env.MONGODB_URI;

function generateVoucherCode(prefix = 'RM20') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix + '-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function generateVouchers(count = 5, discountValue = 20) {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db('azamreka');
    const vouchers = db.collection('vouchers');

    // Create index if it doesn't exist
    await vouchers.createIndex({ code: 1 }, { unique: true });
    await vouchers.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    const generated = [];

    for (let i = 0; i < count; i++) {
      let code;
      let exists = true;

      // Generate unique code
      while (exists) {
        code = generateVoucherCode('RM20');
        const found = await vouchers.findOne({ code });
        exists = !!found;
      }

      const voucher = {
        code,
        discountValue,
        discountType: 'fixed', // fixed amount in RM
        maxUses: 1, // Single use voucher
        currentUses: 0,
        minOrderValue: 0, // No minimum order
        active: true,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year validity
        appliedOrders: []
      };

      const result = await vouchers.insertOne(voucher);
      generated.push({ ...voucher, _id: result.insertedId });
    }

    console.log(`✓ Generated ${generated.length} voucher codes:`);
    generated.forEach((v, idx) => {
      console.log(`  ${idx + 1}. ${v.code} - RM${v.discountValue} discount`);
    });

    return generated;
  } finally {
    await client.close();
  }
}

// Only run as CLI if invoked directly (not imported as module)
if (require.main === module) {
  const args = process.argv.slice(2);
  let count = 5;
  let value = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1]);
      i++;
    }
    if (args[i] === '--value' && args[i + 1]) {
      value = parseInt(args[i + 1]);
      i++;
    }
  }

  generateVouchers(count, value)
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}
