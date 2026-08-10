// api/admin/debug.js
// TEMPORARY — delete this file after diagnosing the password issue.
// Shows which env vars are present (not their values) so we can confirm
// the function runtime is seeing them.

module.exports = async function handler(req, res) {
  return res.status(200).json({
    hasAdminPassword: !!process.env.ADMIN_PASSWORD,
    adminPasswordLength: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 0,
    hasMongoUri: !!process.env.MONGODB_URI,
    hasToyyibPay: !!process.env.TOYYIBPAY_API_KEY,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV
  });
}
