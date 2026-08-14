// api/webhook/billplz.js
// Handles payment confirmation from Billplz + sends confirmation email
// + creates a Sales Order in Zoho Books

const { MongoClient, ObjectId } = require('mongodb');
const { Resend } = require('resend');
const { createSalesOrder } = require('../_lib/zoho-books');

const mongoUri = process.env.MONGODB_URI;
const resendApiKey = process.env.RESEND_API_KEY;
const billplzApiKey = process.env.BILLPLZ_API_KEY;

let cachedClient = null;

async function getMongoClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new MongoClient(mongoUri);
  await cachedClient.connect();
  return cachedClient;
}

async function sendConfirmationEmail(order) {
  const resend = new Resend(resendApiKey);

  const itemsList = order.items.map(item => `• ${item.name} (RM ${item.price.toFixed(2)}) x${item.qty}`).join('\n');

  try {
    await resend.emails.send({
      from: 'orders@azamreka.com',
      to: order.customerEmail,
      subject: `Order Confirmation #${order.billplzId} — Azam Reka`,
      html: `
        <h2>Thank you for your order!</h2>
        <p>Hi ${order.customerName},</p>
        <p>Your payment has been confirmed. We're thrilled to get started on your pieces.</p>

        <h3>Order Details</h3>
        <p><strong>Order ID:</strong> ${order.billplzId}</p>
        <p><strong>Items:</strong></p>
        <pre>${itemsList}</pre>
        <p><strong>Total:</strong> RM ${order.totalAmount.toFixed(2)}</p>

        <h3>Delivery Address</h3>
        <p>${order.customerAddress}</p>

        <h3>What's Next?</h3>
        <p>We'll be in touch within 24 hours to confirm your design and estimated delivery date. You'll receive updates via WhatsApp and email.</p>

        <p>Questions? Reach us at:</p>
        <ul>
          <li>WhatsApp: +60 11-1085 2324</li>
          <li>Email: azam.r3ka@gmail.com</li>
          <li>Instagram: @azam.reka</li>
        </ul>

        <p>Thanks for choosing Azam Reka!</p>
      `
    });
  } catch (error) {
    console.error('Email send error:', error);
  }
}

async function fetchBillFromBillplz(billplzId) {
  // Don't trust the webhook POST body directly — re-fetch the bill from
  // Billplz's API using our own API key. This confirms payment status from
  // a source we trust, without needing to replicate Billplz's X-Signature
  // concatenation algorithm (a common source of subtle bugs).
  const response = await fetch(`https://www.billplz.com/api/v3/bills/${billplzId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(billplzApiKey + ':').toString('base64')}`
    }
  });

  if (!response.ok) {
    throw new Error(`Billplz bill fetch failed: ${response.status}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const billplzId = req.body && req.body.id;
    if (!billplzId) {
      return res.status(200).json({ received: true });
    }

    // Re-fetch the bill from Billplz directly rather than trusting the POST body
    const bill = await fetchBillFromBillplz(billplzId);
    const { paid, paid_amount: amount } = bill;

    if (!paid) {
      // Not paid yet
      return res.status(200).json({ received: true });
    }

    // Update order in MongoDB
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const result = await orders.findOneAndUpdate(
      { billplzId },
      {
        $set: {
          status: 'paid',
          paidAmount: (parseInt(amount, 10) || 0) / 100, // Billplz sends paid_amount in sen
          paidAt: new Date(),
          productionStage: 'confirmed',
          stageUpdatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (result.value) {
      // Send confirmation email
      await sendConfirmationEmail(result.value);

      // Create the Sales Order in Zoho Books — guarded so a duplicate webhook
      // fire (Billplz can retry) never creates two Sales Orders for one order.
      if (!result.value.zohoSalesOrderId) {
        try {
          const zohoResult = await createSalesOrder(result.value);
          await orders.updateOne(
            { billplzId },
            {
              $set: {
                zohoSalesOrderId: zohoResult.salesOrderId,
                zohoSalesOrderNumber: zohoResult.salesOrderNumber,
                zohoUnmappedItems: zohoResult.unmappedItems
              }
            }
          );
          if (zohoResult.unmappedItems.length > 0) {
            console.warn(`Order ${billplzId} has unmapped items in Zoho: ${zohoResult.unmappedItems.join(', ')}`);
          }
        } catch (zohoError) {
          // Don't fail the whole webhook if Zoho sync fails — payment is still
          // confirmed and the customer still gets their email either way.
          console.error(`Zoho Books sync failed for order ${billplzId}:`, zohoError);
          await orders.updateOne(
            { billplzId },
            { $set: { zohoSyncError: String(zohoError.message || zohoError) } }
          );
        }
      }
    }

    return res.status(200).json({ received: true, updated: !!result.value });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ received: true }); // Always return 200 to Billplz
  }
}
