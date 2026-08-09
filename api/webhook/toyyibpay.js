// api/webhook/toyyibpay.js
// Handles payment confirmation from ToyyibPay + sends confirmation email

const { MongoClient, ObjectId } = require('mongodb');
const { Resend } = require('resend');

const mongoUri = process.env.MONGODB_URI;
const resendApiKey = process.env.RESEND_API_KEY;

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
      subject: `Order Confirmation #${order.billCode} — Azam Reka`,
      html: `
        <h2>Thank you for your order!</h2>
        <p>Hi ${order.customerName},</p>
        <p>Your payment has been confirmed. We're thrilled to get started on your pieces.</p>
        
        <h3>Order Details</h3>
        <p><strong>Order ID:</strong> ${order.billCode}</p>
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

export default async function handler(req, res) {
  // ToyyibPay sends data via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { billCode, status, amount } = req.body;

    if (!billCode || status !== '1') {
      // status '1' = paid, '0' = unpaid
      return res.status(200).json({ received: true });
    }

    // Update order in MongoDB
    const client = await getMongoClient();
    const db = client.db('azamreka');
    const orders = db.collection('orders');

    const result = await orders.findOneAndUpdate(
      { billCode },
      {
        $set: {
          status: 'paid',
          paidAmount: parseInt(amount) / 100, // ToyyibPay sends in sen
          paidAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (result.value) {
      // Send confirmation email
      await sendConfirmationEmail(result.value);
    }

    return res.status(200).json({ received: true, updated: !!result.value });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ received: true }); // Always return 200 to ToyyibPay
  }
}
