// api/_lib/order-emails.js
// Shared stage-update email, used by both manual tracking entry
// (api/admin/update-stage.js) and EasyParcel auto-booking
// (api/admin/book-shipment.js) so the two paths can't drift apart.

const { Resend } = require('resend');

const resendApiKey = process.env.RESEND_API_KEY;
const siteUrl = process.env.SITE_URL || 'https://azamreka.com';

/* Current valid stages (7-stage pipeline) */
const VALID_STAGES = ['confirmed', 'design', 'approved_queued', 'cutting_engraving', 'finishing_qc', 'shipped', 'delivered'];

/* Old → new stage mapping for backward compatibility with existing orders */
const STAGE_MAPPING = {
  'cutting': 'cutting_engraving',
  'engraving': 'cutting_engraving'
};

const STAGE_LABELS = {
  confirmed: 'Order Confirmed',
  design: 'Design Proof',
  approved_queued: 'Approved & Queued',
  cutting_engraving: 'Cutting & Engraving',
  finishing_qc: 'Finishing & QC',
  shipped: 'Shipped',
  delivered: 'Order Delivered'
};

const STAGE_MESSAGES = {
  confirmed: 'We\'ve confirmed your order and are getting ready to start.',
  design: 'We\'re finalizing the design proof for your piece.',
  approved_queued: 'Your design is approved and queued for production.',
  cutting_engraving: 'Your piece is being cut and engraved right now.',
  finishing_qc: 'Your piece is being finished and quality-checked.',
  shipped: 'Your piece has shipped and is on its way to you!',
  delivered: 'Your piece has been delivered. Thank you for choosing Azam Reka!'
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

/* Map old stage names to new ones for backward compatibility */
function normalizeStage(stage) {
  return STAGE_MAPPING[stage] || stage;
}

async function sendStageUpdateEmail(order, stage) {
  if (!resendApiKey || !order.customerEmail) return;
  const resend = new Resend(resendApiKey);
  const trackingUrl = `${siteUrl}/track-order.html?billCode=${encodeURIComponent(order.billCode)}`;

  /* Normalize old stage names to new ones */
  const normalizedStage = normalizeStage(stage);

  const shippingLine = ((normalizedStage === 'shipped' || normalizedStage === 'delivered') && order.trackingNumber)
    ? `<p><strong>Courier:</strong> ${COURIER_LABELS[order.courier] || order.courier || 'N/A'}<br>` +
      `<strong>Tracking number:</strong> ${order.trackingNumber}</p>`
    : '';

  try {
    await resend.emails.send({
      from: 'orders@azamreka.com',
      to: order.customerEmail,
      subject: `Order #${order.billCode} update: ${STAGE_LABELS[normalizedStage]} — Azam Reka`,
      html: `
        <h2>Your order has been updated</h2>
        <p>Hi ${order.customerName},</p>
        <p>${STAGE_MESSAGES[normalizedStage]}</p>
        <p><strong>Current stage:</strong> ${STAGE_LABELS[normalizedStage]}</p>
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
  STAGE_MAPPING,
  normalizeStage,
  sendStageUpdateEmail
};
