// api/admin/mongodb-test.js
// Diagnostic endpoint — tests MongoDB connectivity without exposing secrets

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  const { password } = req.query;

  // Require admin password for access
  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const diagnostics = {
    mongoUriSet: !!mongoUri,
    mongoUriPrefix: mongoUri ? mongoUri.substring(0, 20) + '...' : 'NOT SET',
    timestamp: new Date().toISOString(),
    tests: {}
  };

  // Test 1: Check if mongoUri is set
  if (!mongoUri) {
    diagnostics.tests.uriSet = { ok: false, message: 'MONGODB_URI environment variable not set' };
    return res.status(500).json(diagnostics);
  }

  // Test 2: Try to create a client
  try {
    diagnostics.tests.clientCreation = { ok: true, message: 'MongoClient created' };
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });

    // Test 3: Try to connect
    diagnostics.tests.connection = { ok: true, status: 'attempting...' };
    await client.connect();
    diagnostics.tests.connection = { ok: true, status: 'connected' };

    // Test 4: Check database
    const db = client.db('azamreka');
    const adminCommand = await db.admin().ping();
    diagnostics.tests.ping = { ok: true, message: 'Ping successful' };

    // Test 5: Check collection
    const collections = await db.listCollections().toArray();
    diagnostics.tests.collections = {
      ok: true,
      count: collections.length,
      names: collections.map(c => c.name)
    };

    // Test 6: Try to query orders
    const orders = db.collection('orders');
    const count = await orders.countDocuments();
    diagnostics.tests.ordersQuery = {
      ok: true,
      orderCount: count,
      message: count === 0 ? 'No orders in database' : `${count} orders found`
    };

    await client.close();
    diagnostics.allTestsPassed = true;

    return res.status(200).json(diagnostics);
  } catch (error) {
    diagnostics.tests.connectionError = {
      ok: false,
      message: error.message,
      code: error.code,
      type: error.constructor.name
    };
    return res.status(500).json(diagnostics);
  }
}
