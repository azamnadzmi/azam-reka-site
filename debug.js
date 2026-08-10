// api/admin/debug.js
// TEMPORARY — delete this file after diagnosing the password issue.

module.exports = async function handler(req, res) {
  const { password } = req.query;
  const stored = process.env.ADMIN_PASSWORD;

  return res.status(200).json({
    hasAdminPassword: !!stored,
    adminPasswordLength: stored ? stored.length : 0,
    adminPasswordCharCodes: stored ? [...stored].map(c => c.charCodeAt(0)) : [],
    receivedPassword: password || '(none)',
    receivedPasswordLength: password ? password.length : 0,
    receivedCharCodes: password ? [...password].map(c => c.charCodeAt(0)) : [],
    match: password === stored,
    hasMongoUri: !!process.env.MONGODB_URI,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV
  });
}
