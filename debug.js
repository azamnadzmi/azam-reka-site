// api/admin/debug.js
// TEMPORARY — delete this file after diagnosing the password issue.

module.exports = async function handler(req, res) {
  const p = req.query.password;
  const s = process.env.ADMIN_PASSWORD;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    v: 2,
    sl: s ? s.length : 0,
    sc: s ? Array.from(s).map(c => c.charCodeAt(0)) : [],
    pl: p ? p.length : 0,
    pc: p ? Array.from(p).map(c => c.charCodeAt(0)) : [],
    ok: p === s
  }));
}
