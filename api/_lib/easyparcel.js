// api/_lib/easyparcel.js
// Client for EasyParcel's current Open API (OAuth 2.0, JSON, Bearer tokens).
//
// This supersedes an earlier version of this file built against a 2018 PDF
// for EasyParcel's older "Individual API" (form-encoded, single api-key
// param, ?ac=EPRateCheckingBulk style). That API still exists but new app
// registrations go through OAuth now — confirmed by the account's own
// Developer Hub "Configuration" screen (App Name / Client ID / Client Secret),
// not by trusting a web-search summary.
//
// IMPORTANT — how this was verified, and what wasn't:
// WebFetch against easyparcel.github.io/OpenAPI and its rendered HTML
// repeatedly returned plausible-looking but FABRICATED content (generic
// "John Doe"/"Jane Smith" examples, a field named "state" that contradicts
// the real API's actual field name). Do not trust prose summaries of that
// site for field names. What IS verified, from the repo's raw Postman
// collection JSON (a machine format the summarizer can't rewrite without it
// being obviously truncated, which it honestly reported rather than
// inventing content):
//   -auth flow: source/includes/2026-06/_authentication.md (detailed,
//     internally consistent, real GitHub asset URLs for screenshots)
//   - POST .../shipment/quotations request shape, incl. the exact field
//     "subdivison_code" (EasyParcel's own typo — reproduce it exactly)
//   - POST .../shipment/quotations response shape, incl. courier/pricing
//     field names, from a saved example response in the Postman collection
// NOT verified — booking (submit_orders) and tracking field names. Prose
// fetches for these produced inconsistent/fabricated results. bookShipment()
// and trackParcel() are a best-effort implementation using the same
// sender/receiver shape confirmed for quotations, extended with conventional
// field names — treat as unverified until confirmed against a real response.

const { MongoClient } = require('mongodb');

const CLIENT_ID = process.env.EASYPARCEL_CLIENT_ID;
const CLIENT_SECRET = process.env.EASYPARCEL_CLIENT_SECRET;
const ENV_REFRESH_TOKEN = process.env.EASYPARCEL_REFRESH_TOKEN;
const mongoUri = process.env.MONGODB_URI;

// EasyParcel rotates the refresh_token on every use — the response to a
// refresh_token grant includes a NEW refresh_token that must be used next
// time (the old one is invalidated). Vercel env vars aren't writable from
// running code, so the current token is persisted in MongoDB instead, with
// the env var only as a one-time seed for the very first request.
let cachedMongoClient = null;
async function getMongoClient() {
  if (cachedMongoClient) return cachedMongoClient;
  cachedMongoClient = new MongoClient(mongoUri);
  await cachedMongoClient.connect();
  return cachedMongoClient;
}

async function getStoredRefreshToken() {
  const client = await getMongoClient();
  const settings = client.db('azamreka').collection('settings');
  const doc = await settings.findOne({ _id: 'easyparcel_refresh_token' });
  return (doc && doc.value) || ENV_REFRESH_TOKEN;
}

async function saveRefreshToken(newToken) {
  const client = await getMongoClient();
  const settings = client.db('azamreka').collection('settings');
  await settings.updateOne(
    { _id: 'easyparcel_refresh_token' },
    { $set: { value: newToken, updatedAt: new Date() } },
    { upsert: true }
  );
}

const AUTH_BASE = 'https://api.easyparcel.com';
const API_BASE = 'https://api.easyparcel.com/open_api/2026-06';

// The only two couriers Azam Reka books through.
const ALLOWED_COURIERS = ['MELPLUS', 'JNT'];

function classifyCourier(courier) {
  const hay = `${courier.courier_name || ''} ${courier.service_name || ''}`.toLowerCase();
  // MelPlus is a branded service run by Poslaju, not its own courier_name.
  if (hay.includes('melplus') || hay.includes('poslaju')) return 'MELPLUS';
  if (hay.includes('j&t') || hay.includes('jnt') || hay.includes('j & t')) return 'JNT';
  return null;
}

// Fixed pickup point for every shipment — Azam Reka has one origin address.
const SENDER_ADDRESS = {
  name: 'Azam Nadzmi',
  company: '@azam.reka',
  contact: '+601155094344',
  mobile: '+6084369659',
  addr1: 'Bora Residences, A24-06, Jalan Danga 1/1',
  addr2: '',
  city: 'Johor Bahru',
  state: 'jhr',
  postcode: '80200'
};

// Malaysian state -> ISO 3166-2:MY subdivision code, which is what the real
// API's "subdivison_code" field takes. ISO 3166-2:MY is a stable external
// standard (not EasyParcel-specific), cross-checked against the one
// EasyParcel doc fragment that survived extraction intact ("MY-07 represents
// Penang, Malaysia" — matches row 7 below).
const MY_STATES = [
  { code: 'jhr', name: 'Johor', subdivision: 'MY-01' },
  { code: 'kdh', name: 'Kedah', subdivision: 'MY-02' },
  { code: 'ktn', name: 'Kelantan', subdivision: 'MY-03' },
  { code: 'mlk', name: 'Melaka', subdivision: 'MY-04' },
  { code: 'nsn', name: 'Negeri Sembilan', subdivision: 'MY-05' },
  { code: 'phg', name: 'Pahang', subdivision: 'MY-06' },
  { code: 'png', name: 'Pulau Pinang', subdivision: 'MY-07' },
  { code: 'prk', name: 'Perak', subdivision: 'MY-08' },
  { code: 'pls', name: 'Perlis', subdivision: 'MY-09' },
  { code: 'sgr', name: 'Selangor', subdivision: 'MY-10' },
  { code: 'trg', name: 'Terengganu', subdivision: 'MY-11' },
  { code: 'sbh', name: 'Sabah', subdivision: 'MY-12' },
  { code: 'srw', name: 'Sarawak', subdivision: 'MY-13' },
  { code: 'kul', name: 'Kuala Lumpur', subdivision: 'MY-14' },
  { code: 'lbn', name: 'Labuan', subdivision: 'MY-15' },
  { code: 'pjy', name: 'Putrajaya', subdivision: 'MY-16' }
];

function subdivisionFor(stateCode) {
  const match = MY_STATES.find(s => s.code === stateCode);
  if (!match) throw new Error(`Unknown Malaysian state code: ${stateCode}`);
  return match.subdivision;
}

// --- OAuth token exchange ------------------------------------------------

let cachedToken = null; // { accessToken, expiresAt } — reused within a warm serverless instance

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !ENV_REFRESH_TOKEN) {
    throw new Error('EASYPARCEL_CLIENT_ID / EASYPARCEL_CLIENT_SECRET / EASYPARCEL_REFRESH_TOKEN not fully set');
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const currentRefreshToken = await getStoredRefreshToken();

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: currentRefreshToken })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EasyParcel token refresh failed: HTTP ${response.status} — ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`EasyParcel token refresh returned no access_token: ${JSON.stringify(data).slice(0, 300)}`);
  }

  // EasyParcel rotates refresh tokens — persist the new one for next time.
  if (data.refresh_token && data.refresh_token !== currentRefreshToken) {
    await saveRefreshToken(data.refresh_token);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
  return cachedToken.accessToken;
}

/**
 * Exchange a one-time OAuth authorization `code` for tokens. Only used by
 * the (temporary) OAuth callback endpoint during initial setup — not part
 * of normal request handling.
 */
async function exchangeAuthorizationCode(code, redirectUri) {
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: redirectUri, code })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`EasyParcel authorization code exchange failed: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function callEasyParcel(path, body) {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`EasyParcel returned non-JSON for ${path}: HTTP ${response.status} — ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data.status_code !== 200) {
    throw new Error(`EasyParcel error ${data.status_code} on ${path}: ${data.message || 'no message'} — HTTP ${response.status}, body: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

// --- Rate checking (verified) --------------------------------------------

/**
 * Get live courier rates between two Malaysian addresses, filtered to the
 * two couriers Azam Reka actually books (MelPlus/Poslaju, J&T).
 */
async function checkRates({ pickCode, pickState, sendCode, sendState, weight }) {
  const data = await callEasyParcel('/shipment/quotations', {
    shipment: [{
      sender: { postcode: pickCode, subdivison_code: subdivisionFor(pickState), country: 'MY' },
      receiver: { postcode: sendCode, subdivison_code: subdivisionFor(sendState), country: 'MY' },
      weight
    }]
  });

  const row = (data.data && data.data[0]) || {};
  if (row.status !== 'success') {
    throw new Error(`Rate check failed: ${row.message || row.status || 'unknown'}`);
  }

  // EasyParcel returns "MelPlus" and "Poslaju" as separate line items even
  // though they're the same underlying courier/network — display name only.
  const DISPLAY_NAME = { MELPLUS: 'Poslaju', JNT: 'J&T Express' };

  const matched = [];
  for (const rate of row.quotations || []) {
    const courier = rate.courier || {};
    const classified = classifyCourier(courier);
    if (!classified) continue;
    // Only pickup-from-door services — drop-off variants require the sender
    // to bring the parcel to a courier point themselves, which isn't how
    // Azam Reka ships (SENDER_ADDRESS is a home address, not staffed to
    // drop off parcels during business hours).
    if (!courier.is_pickup) continue;
    matched.push({
      courier: classified,
      courierName: DISPLAY_NAME[classified] || courier.courier_name,
      serviceId: courier.service_id,
      serviceName: courier.service_name,
      price: parseFloat((rate.pricing || {}).total_amount || '0'),
      delivery: courier.delivery_duration || null
    });
  }
  matched.sort((a, b) => a.price - b.price);

  // Collapse to one entry per courier (MelPlus/Poslaju is a single courier
  // under two names) — keep the cheapest service in each group.
  const seen = new Set();
  const deduped = [];
  for (const rate of matched) {
    if (seen.has(rate.courier)) continue;
    seen.add(rate.courier);
    deduped.push(rate);
  }
  return deduped;
}

/** Raw, unfiltered quotation response — for diagnosing "0 matched rates". */
async function debugRawRates({ pickCode, pickState, sendCode, sendState, weight }) {
  return callEasyParcel('/shipment/quotations', {
    shipment: [{
      sender: { postcode: pickCode, subdivison_code: subdivisionFor(pickState), country: 'MY' },
      receiver: { postcode: sendCode, subdivison_code: subdivisionFor(sendState), country: 'MY' },
      weight
    }]
  });
}

// --- Order submission + payment (UNVERIFIED — see file header) -----------

/**
 * Book a parcel. UNVERIFIED field names — see file header. Do not treat a
 * successful-looking response as trustworthy until confirmed against a real
 * API call; a wrong field name may cause EasyParcel to silently ignore it
 * rather than error.
 */
async function bookShipment({ sender, receiver, parcel, serviceId, dateColl }) {
  const data = await callEasyParcel('/shipment/submit_orders', {
    shipment: [{
      service_id: serviceId,
      collection_date: dateColl,
      weight: parcel.weight,
      parcel_description: parcel.content,
      parcel_value: parcel.value,
      reference: parcel.reference || '',
      sender: {
        name: sender.name,
        phone: sender.contact,
        address_line_1: sender.addr1,
        address_line_2: sender.addr2 || '',
        city: sender.city,
        postcode: sender.postcode,
        subdivison_code: subdivisionFor(sender.state),
        country: 'MY'
      },
      receiver: {
        name: receiver.name,
        phone: receiver.contact,
        address_line_1: receiver.addr1,
        address_line_2: receiver.addr2 || '',
        city: receiver.city,
        postcode: receiver.postcode,
        subdivison_code: subdivisionFor(receiver.state),
        country: 'MY'
      }
    }]
  });

  const row = (data.data && data.data[0]) || {};
  const shipment = (row.shipments && row.shipments[0]) || {};

  return {
    orderNo: (row.order_details || {}).order_number || row.order_number,
    price: parseFloat((row.pricing_breakdown || {}).total_amount || '0'),
    trackingNumber: shipment.tracking_number || shipment.awb || '',
    labelUrl: shipment.awb_url || shipment.label_url || '',
    raw: row // kept until this is verified, so a caller can inspect what actually came back
  };
}

// --- Tracking (UNVERIFIED — see file header) ------------------------------

async function trackParcel(trackingId) {
  const data = await callEasyParcel('/shipment/tracking_status', { tracking_id: trackingId });
  const row = data.data || {};
  return {
    latestStatus: row.status,
    latestUpdate: row.estimated_delivery || null,
    events: (row.events || []).map(e => ({
      date: (e.timestamp || '').split('T')[0] || '',
      time: (e.timestamp || '').split('T')[1] || '',
      status: e.status,
      location: e.location
    }))
  };
}

module.exports = {
  checkRates,
  debugRawRates,
  bookShipment,
  trackParcel,
  classifyCourier,
  exchangeAuthorizationCode,
  saveRefreshToken,
  ALLOWED_COURIERS,
  SENDER_ADDRESS,
  MY_STATES,
  subdivisionFor,
  AUTH_BASE
};
