// api/_lib/order-emails.js
// Shared stage-update email, used by both manual tracking entry
// (api/admin/update-stage.js) and EasyParcel auto-booking
// (api/admin/book-shipment.js) so the two paths can't drift apart.

const { Resend } = require('resend');

const resendApiKey = process.env.RESEND_API_KEY;
const siteUrl = process.env.SITE_URL || 'https://azamreka.com';

const VALID_STAGES = ['confirmed', 'design', 'cutting', 'engraving', 'finishing_qc', 'shipped'];

const STAGE_LABELS = {
  confirmed: 'Order Confirmed',
  design: 'Design Proof',
  cutting: 'Cutting',
  engraving: 'Engraving',
  finishing_qc: 'Finishing & QC',
  shipped: 'Shipped'
};

const STAGE_MESSAGES = {
  confirmed: 'We\'ve confirmed your order and are getting ready to start.',
  design: 'We\'re finalizing the design proof for your piece.',
  cutting: 'Your piece is being cut right now.',
  engraving: 'Your piece is being engraved.',
  finishing_qc: 'Your piece is being finished and quality-checked.',
  shipped: 'Your piece has shipped and is on its way to you!'
};

// EasyParcel bookings only ever produce MELPLUS or JNT (see
// api/_lib/easyparcel.js ALLOWED_COURIERS). The other entries exist for
// manual tracking entry — e.g. a courier booked outside EasyParcel.
const COURIER_LABELS = {
  MELPLUS: 'MelPlus (Poslaju)',
  JNT: 'J&T Express',
  POSLAJU: 'Pos Laju',
  GDEX: 'GDEX',
  DHL: 'DHL',
  NINJA: 'Ninja Van'
};

async function sendStageUpdateEmail(order, stage) {
  if (!resendApiKey || !order.customerEmail) return;
  const resend = new Resend(resendApiKey);
  const trackingUrl = `${siteUrl}/track-order.html?billCode=${encodeURIComponent(order.billCode)}`;

  const shippingLine = (stage === 'shipped' && order.trackingNumber)
    ? `<p><strong>Courier:</strong> ${COURIER_LABELS[order.courier] || order.courier || 'N/A'}<br>` +
      `<strong>Tracking number:</strong> ${order.trackingNumber}</p>`
    : '';

  try {
    await resend.emails.send({
      from: 'orders@azamreka.com',
      to: order.customerEmail,
      subject: `Order #${order.billCode} update: ${STAGE_LABELS[stage]} — Azam Reka`,
      html: `
        <h2>Your order has been updated</h2>
        <p>Hi ${order.customerName},</p>
        <p>${STAGE_MESSAGES[stage]}</p>
        <p><strong>Current stage:</strong> ${STAGE_LABELS[stage]}</p>
        ${shippingLine}
        <p><a href="${trackingUrl}">Track your order</a> for full progress details.</p>
        <p>Questions? WhatsApp us at +60 11-1085 2324.</p>
        <p>Thanks for choosing Azam Reka!</p>
      `
    });
  } catch (error) {
    console.error('Stage update email error:', error);
    // Don't fail the caller if the email fails to send
  }
}

module.exports = {
  VALID_STAGES,
  STAGE_LABELS,
  STAGE_MESSAGES,
  COURIER_LABELS,
  sendStageUpdateEmail
};
