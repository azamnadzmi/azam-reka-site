// api/admin/easyparcel-oauth-callback.js
// TEMPORARY — one-time OAuth setup endpoint. Delete this file (and its slot
// in Vercel's 12-function limit) once EASYPARCEL_REFRESH_TOKEN has been
// captured and saved. Not needed for normal operation — getAccessToken() in
// api/_lib/easyparcel.js refreshes tokens on its own from then on.
//
// EasyParcel redirects the browser here with ?code=... after the admin logs
// into their EasyParcel account and clicks Allow. This exchanges that code
// for an access_token + refresh_token and displays them (password-gated,
// since a refresh_token is a real credential) so the admin can copy the
// refresh_token into Vercel's EASYPARCEL_REFRESH_TOKEN env var by hand.
// Nothing is stored automatically — Vercel env vars aren't writable from
// application code, and a human should be the one moving a credential into
// place anyway.

const { exchangeAuthorizationCode, saveRefreshToken } = require('../_lib/easyparcel');

const adminPassword = process.env.ADMIN_PASSWORD;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>EasyParcel OAuth Setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1.5rem;line-height:1.5;}
code,pre{background:#f5f3f0;padding:0.2em 0.4em;border-radius:3px;font-size:0.9em;word-break:break-all;}
pre{padding:1em;white-space:pre-wrap;}</style></head><body>${body}</body></html>`;
}

module.exports = async function handler(req, res) {
  const { code, password, error: oauthError } = req.query;

  if (!adminPassword || password !== adminPassword) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(401).send(page('<h1>Unauthorized</h1><p>Append <code>&password=YOUR_ADMIN_PASSWORD</code> to this URL.</p>'));
  }

  if (oauthError) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(page(`<h1>EasyParcel declined authorization</h1><p>${escapeHtml(oauthError)}</p>`));
  }

  if (!code) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(page('<h1>No authorization code</h1><p>This page is meant to be reached via EasyParcel\'s redirect after clicking Allow, not visited directly.</p>'));
  }

  try {
    const redirectUri = `https://${req.headers.host}/api/admin/easyparcel-oauth-callback`;
    const tokens = await exchangeAuthorizationCode(code, redirectUri);

    // Save straight to MongoDB — EasyParcel rotates refresh tokens on every
    // use, so getAccessToken() reads/writes this store from now on and the
    // Vercel env var is only needed as a first-run fallback.
    await saveRefreshToken(tokens.refresh_token);

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(page(`
      <h1>Connected</h1>
      <p>The refresh token has been saved automatically — no need to copy it into Vercel.</p>
      <p>Access token expires in ${escapeHtml(tokens.expires_in)}s — normal, <code>getAccessToken()</code> refreshes it automatically and keeps saving the new rotated token each time.</p>
      <p>You can now delete <code>api/admin/easyparcel-oauth-callback.js</code> — it's a one-time setup endpoint and Vercel's Hobby plan caps at 12 functions.</p>
    `));
  } catch (error) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(page(`<h1>Token exchange failed</h1><pre>${escapeHtml(error.message)}</pre>`));
  }
};
