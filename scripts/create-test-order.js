// scripts/create-test-order.js
// One-off: inserts a throwaway test order so we can verify the message
// portal end-to-end without going through Zoho/Billplz. Delete this file
// once testing is done — it's not meant to be a permanent admin tool.
//
// Usage (from the azam-reka-site directory):
//   MONGODB_URI="your-real-uri-here" node scripts/create-test-order.js

const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri || mongoUri.includes('username:password')) {
  console.error('Set a real MONGODB_URI env var before running this (see the comment at the top of this file).');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('azamreka');
  const orders = db.collection('orders');

  const billCode = 'TEST-' + Date.now().toString().slice(-6);
  const order = {
    billCode,
    customerName: 'Test Customer',
    customerEmail: 'test@example.com',
    customerPhone: '0123456789',
    customerAddress: '123 Test Street, Test City',
    items: [{ name: 'Plaque', price: 17, qty: 1 }],
    totalAmount: 17,
    status: 'paid',
    productionStage: 'confirmed',
    paidAt: new Date(),
    stageUpdatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await orders.insertOne(order);
  console.log('Test order created.');
  console.log('billCode:', billCode);
  console.log('phone:', order.customerPhone);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
