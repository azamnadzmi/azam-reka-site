// api/admin/env-check.js
// Diagnostic — checks if environment variables are set (without exposing values)

module.exports = async function handler(req, res) {
  const { password } = req.query;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const env = {
    MONGODB_URI: {
      set: !!process.env.MONGODB_URI,
      length: process.env.MONGODB_URI?.length || 0,
      hasProtocol: process.env.MONGODB_URI?.startsWith('mongodb') || false,
      preview: process.env.MONGODB_URI?.substring(0, 30) + '...' || 'NOT SET'
    },
    ADMIN_PASSWORD: {
      set: !!adminPassword,
      matches_query: password === adminPassword
    },
    RESEND_API_KEY: { set: !!process.env.RESEND_API_KEY },
    TOYYIBPAY_API_KEY: { set: !!process.env.TOYYIBPAY_API_KEY },
    ZOHO_CLIENT_ID: { set: !!process.env.ZOHO_CLIENT_ID },
    ZOHO_REFRESH_TOKEN: { set: !!process.env.ZOHO_REFRESH_TOKEN }
  };

  return res.status(200).json({ environment: env, timestamp: new Date().toISOString() });
}
